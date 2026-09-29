import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { QuestionSource } from "@/lib/rag/calibrate";
import { type CitationMeasurement, type CitationRun, summarizeAnswers } from "./citation-stats";

/**
 * The runs of the citation measurement (spec §11, S-19): the frozen question set, its split
 * into runs of at most 15 questions, each run's own file (template §7.5, U-P4), and the
 * aggregate of every run of the one set.
 */

export const MEASUREMENT_SET_PATH = "measurements/questions.json";

/**
 * An English question of the frozen set (S-13): one the docs answer, with the passage that
 * answers it, or a near-miss they do not cover, named by terms no corpus file contains, whose
 * correct answer is a refusal (S-10).
 */
export type MeasurementQuestion = { id: string; question: string } & (
  ({ inScope: true } & QuestionSource) | { inScope: false; notInCorpus: string[] }
);

export type MeasurementSet = { about: string; questions: MeasurementQuestion[] };

/** Questions per run: a run fits in one hour of the 20-request limit (S-19). */
export const MAX_QUESTIONS_PER_RUN = 15;

/** The aggregate's metric name; each run saves under runMetric(run). */
export const CITATIONS_METRIC = "citations";

export function runMetric(run: number): string {
  return `${CITATIONS_METRIC}-run-${run}`;
}

/** The fewest runs of at most MAX_QUESTIONS_PER_RUN questions. */
export function runCount(questions: number): number {
  if (questions < 1) throw new RangeError("The measurement set has no questions.");
  return Math.ceil(questions / MAX_QUESTIONS_PER_RUN);
}

/** Run `run`'s questions: the set split in order into runs whose sizes differ by at most one. */
export function runQuestions<T>(questions: readonly T[], run: number): T[] {
  const runs = runCount(questions.length);
  if (!Number.isInteger(run) || run < 1 || run > runs) {
    throw new RangeError(`The set has runs 1 to ${runs}, not ${run}.`);
  }
  const size = Math.floor(questions.length / runs);
  const larger = questions.length % runs;
  const start = (run - 1) * size + Math.min(run - 1, larger);
  return questions.slice(start, start + size + (run <= larger ? 1 : 0));
}

/** MEASURE_RUN, the run to ask. */
export function parseRun(value: string | undefined, runs: number): number {
  const digits = value?.trim() ?? "";
  const run = /^\d+$/.test(digits) ? Number(digits) : 0;
  if (run < 1 || run > runs) {
    throw new Error(`Set MEASURE_RUN to the run to ask, from 1 to ${runs} (spec §11, S-19).`);
  }
  return run;
}

/** The frozen set and the SHA-256 of its file, which every run records. */
export function readMeasurementSet(root: string): { set: MeasurementSet; sha256: string } {
  const bytes = readFileSync(path.join(root, MEASUREMENT_SET_PATH));
  return {
    set: JSON.parse(bytes.toString("utf8")) as MeasurementSet,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** A run's file under measurements/, as saveMeasurement names it. */
export type RunFile = { file: string; run: number; aborted: boolean; record: CitationRun };

const RUN_FILE = /^citations-run-(\d+)-\d{4}-\d{2}-\d{2}(-\d{6}\.aborted)?\.json$/;

/** The run and outcome in a run file's name, or null for any other file. */
export function parseRunFileName(name: string): { run: number; aborted: boolean } | null {
  const match = RUN_FILE.exec(name);
  return match ? { run: Number(match[1]), aborted: match[2] !== undefined } : null;
}

/** Every run file under measurements/, good and aborted, in name order. */
export function readRunFiles(root: string): RunFile[] {
  return readdirSync(path.join(root, "measurements"))
    .sort()
    .flatMap((name) => {
      const parsed = parseRunFileName(name);
      if (parsed === null) return [];
      const file = `measurements/${name}`;
      const record = JSON.parse(readFileSync(path.join(root, file), "utf8")) as CitationRun;
      return [{ file, ...parsed, record }];
    });
}

/**
 * Refuses to ask a run again once it has a good file, whatever its day, before any of the
 * hour's requests is spent: the aggregate takes exactly one good file per run.
 */
export function assertRunNotMeasured(files: readonly RunFile[], run: number): void {
  const good = files.find((file) => file.run === run && !file.aborted);
  if (good === undefined) return;
  throw new Error(
    `Run ${run} is already measured in ${good.file}. ` +
      `Delete or rename that file on purpose to ask run ${run} again.`,
  );
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * When a new run gets the whole hourly quota back after the runs so far: the start of the
 * second UTC hour after their last request. The limiter counts in UTC clock hours and weighs
 * in the previous hour's requests by how much of it overlaps the last 60 minutes, so an hour
 * later is not enough (lib/rate-limit.ts, Upstash slidingWindow). Null before any request.
 */
export function quotaFreeAt(files: readonly RunFile[]): string | null {
  const times = files.flatMap(({ record }) =>
    record.lastRequestAt === null ? [] : [Date.parse(record.lastRequestAt)],
  );
  if (times.length === 0) return null;
  const hour = Math.floor(Math.max(...times) / HOUR_MS);
  return new Date((hour + 2) * HOUR_MS).toISOString();
}

/**
 * Joins one good file per run into the measurement of the whole set (spec §11). Every run must
 * have asked this version of the set, exactly its questions, against one URL and model, from
 * one location.
 */
export function aggregateRuns(
  files: readonly RunFile[],
  set: { path: string; sha256: string; ids: readonly string[] },
): CitationMeasurement {
  const runs = runCount(set.ids.length);
  const good = files.filter(({ aborted }) => !aborted);
  const extra = good.find(({ run }) => run < 1 || run > runs);
  if (extra) throw new Error(`${extra.file} is not a run of the set, which has ${runs}.`);

  const chosen = Array.from({ length: runs }, (_, i) => {
    const run = i + 1;
    const matches = good.filter((file) => file.run === run);
    if (matches.length === 0) {
      throw new Error(`Run ${run} has no good file yet: ask it with MEASURE_RUN=${run}.`);
    }
    if (matches.length > 1) {
      const names = matches.map(({ file }) => file).join(", ");
      throw new Error(`Run ${run} has ${matches.length} good files: ${names}. Keep one.`);
    }
    return matches[0];
  });

  const [first] = chosen;
  for (const { run, record } of chosen) {
    const expected = runQuestions(set.ids, run);
    if (record.questionSet.sha256 !== set.sha256 || record.questionSet.path !== set.path) {
      throw new Error(
        `Run ${run} asked another version of ${set.path} ` +
          `(sha256 ${record.questionSet.sha256.slice(0, 12)}…).`,
      );
    }
    const asked = record.answers.map(({ id }) => id);
    if (asked.join() !== expected.join() || record.questionIds.join() !== expected.join()) {
      throw new Error(
        `Run ${run} did not answer exactly its questions, ${expected[0]} to ${expected.at(-1)}.`,
      );
    }
    for (const field of ["url", "model", "location"] as const) {
      if (record[field] !== first.record[field]) {
        throw new Error(`Run ${run} has another ${field} than run 1: ${record[field]}.`);
      }
    }
  }

  const answers = chosen.flatMap(({ record }) => record.answers);
  return {
    // The last run's start names the file.
    date: chosen.map(({ record }) => record.date).sort()[runs - 1],
    aborted: false,
    url: first.record.url,
    model: first.record.model,
    location: first.record.location,
    questionSet: { path: set.path, sha256: set.sha256, questions: set.ids.length },
    runs: chosen.map(({ file, record }) => ({
      run: record.run,
      file,
      date: record.date,
      commit: record.commit,
      userAgent: record.userAgent,
      browserVersion: record.browserVersion,
      platform: record.platform,
      questionIds: record.questionIds,
      lastRequestAt: record.lastRequestAt,
    })),
    answers,
    summary: summarizeAnswers(answers),
  };
}
