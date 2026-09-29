import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateRuns,
  assertRunNotMeasured,
  MAX_QUESTIONS_PER_RUN,
  MEASUREMENT_SET_PATH,
  parseRun,
  parseRunFileName,
  quotaFreeAt,
  readMeasurementSet,
  readRunFiles,
  type RunFile,
  runCount,
  runMetric,
  runQuestions,
} from "./citation-runs";
import { type AnswerRecord, type CitationRun, summarizeAnswers } from "./citation-stats";

const IDS = Array.from({ length: 40 }, (_, i) => `m${String(i + 1).padStart(2, "0")}`);
const SET = { path: MEASUREMENT_SET_PATH, sha256: "a".repeat(64), ids: IDS };

function answer(id: string): AnswerRecord {
  return {
    id,
    question: `Question ${id}?`,
    inScope: true,
    askedAt: "2026-10-05T14:00:00.000Z",
    classification: "answered-with-citations",
    answer: `Answer ${id} [1: "three quoted words"].`,
    citations: [{ type: "citation", n: 1, quote: "three quoted words", status: "verified" }],
    finishReason: "stop",
    topScore: 0.5,
    threshold: 0.3,
    searchMs: 0.3,
    usage: { inputTokens: 2300, outputTokens: 150, totalTokens: 2450 },
    sources: [],
  };
}

/** A complete good run of the 40-question set, started at `date`. */
function runFile(run: number, date: string, overrides: Partial<CitationRun> = {}): RunFile {
  const questionIds = runQuestions(IDS, run);
  const record: CitationRun = {
    date,
    url: "https://rag-citations.example.com",
    model: "openai/gpt-6-luna",
    location: "Recife, home fibre",
    userAgent: "Mozilla/5.0 (test)",
    browserVersion: "153.0.8010.12",
    platform: "darwin 25.6.0",
    commit: `commit-${run}`,
    aborted: false,
    abortReason: null,
    run,
    runs: 3,
    questionSet: { path: SET.path, sha256: SET.sha256 },
    questionIds,
    lastRequestAt: date.replace(":00:00.000Z", ":09:30.000Z"),
    answers: questionIds.map(answer),
    ...overrides,
  };
  const aborted = record.aborted;
  const suffix = aborted ? "-140000.aborted" : "";
  const file = `measurements/${runMetric(run)}-${date.slice(0, 10)}${suffix}.json`;
  return { file, run, aborted, record };
}

const RUNS = [
  runFile(1, "2026-10-05T14:00:00.000Z"),
  runFile(2, "2026-10-05T17:00:00.000Z"),
  runFile(3, "2026-10-06T09:00:00.000Z"),
];

describe("the runs of the measurement set (S-19)", () => {
  it("needs the fewest runs of at most 15 questions", () => {
    expect(MAX_QUESTIONS_PER_RUN).toBe(15);
    expect([1, 15, 16, 30, 31, 40, 45].map(runCount)).toEqual([1, 1, 2, 2, 3, 3, 3]);
    expect(() => runCount(0)).toThrow(RangeError);
  });

  it("splits the set in order into runs whose sizes differ by at most one", () => {
    expect(runQuestions(IDS, 1)).toEqual(IDS.slice(0, 14));
    expect(runQuestions(IDS, 2)).toEqual(IDS.slice(14, 27));
    expect(runQuestions(IDS, 3)).toEqual(IDS.slice(27, 40));
    expect(runQuestions(IDS.slice(0, 30), 2)).toEqual(IDS.slice(15, 30));
    expect(() => runQuestions(IDS, 4)).toThrow(RangeError);
    expect(() => runQuestions(IDS, 0)).toThrow(RangeError);
  });

  it("splits the committed set into three runs that ask every question once", () => {
    const { set } = readMeasurementSet(process.cwd());
    const ids = set.questions.map(({ id }) => id);
    const runs = runCount(ids.length);
    const asked = Array.from({ length: runs }, (_, i) => runQuestions(ids, i + 1));

    expect(runs).toBe(3);
    expect(asked.flat()).toEqual(ids);
    for (const questions of asked) expect(questions.length).toBeLessThanOrEqual(15);
  });

  it("reads MEASURE_RUN as a run number of the set", () => {
    expect(parseRun("2", 3)).toBe(2);
    expect(parseRun(" 3 ", 3)).toBe(3);
    for (const value of [undefined, "", "0", "4", "1.5", "one", "-1"]) {
      expect(() => parseRun(value, 3), String(value)).toThrow(
        "Set MEASURE_RUN to the run to ask, from 1 to 3 (spec §11, S-19).",
      );
    }
  });

  it("names each run's metric apart, as template §7.5 asks (U-P4)", () => {
    expect(runMetric(1)).toBe("citations-run-1");
    expect(runMetric(3)).toBe("citations-run-3");
  });
});

describe("readMeasurementSet", () => {
  it("reads the frozen set and the SHA-256 of its file", () => {
    const { set, sha256 } = readMeasurementSet(process.cwd());
    const bytes = readFileSync(MEASUREMENT_SET_PATH);

    expect(set.questions.length).toBeGreaterThan(0);
    expect(sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("the run files", () => {
  it("parses a good or aborted run file's name, and nothing else", () => {
    expect(parseRunFileName("citations-run-2-2026-10-05.json")).toEqual({
      run: 2,
      aborted: false,
    });
    expect(parseRunFileName("citations-run-2-2026-10-05-140359.aborted.json")).toEqual({
      run: 2,
      aborted: true,
    });
    for (const name of ["questions.json", "citations-2026-10-06.json", "citations-run-x.json"]) {
      expect(parseRunFileName(name), name).toBeNull();
    }
  });

  it("reads every run file under measurements/, in name order", () => {
    const root = mkdtempSync(path.join(tmpdir(), "citation-runs-"));
    mkdirSync(path.join(root, "measurements"));
    const write = (name: string, record: object) =>
      writeFileSync(path.join(root, "measurements", name), JSON.stringify(record));
    write("questions.json", { about: "", questions: [] });
    write("citations-2026-10-06.json", {});
    write("citations-run-2-2026-10-05.json", { run: 2 });
    write("citations-run-1-2026-10-05-140000.aborted.json", { run: 1 });

    expect(readRunFiles(root)).toEqual([
      {
        file: "measurements/citations-run-1-2026-10-05-140000.aborted.json",
        run: 1,
        aborted: true,
        record: { run: 1 },
      },
      {
        file: "measurements/citations-run-2-2026-10-05.json",
        run: 2,
        aborted: false,
        record: { run: 2 },
      },
    ]);
  });
});

describe("assertRunNotMeasured", () => {
  it("refuses a run that already has a good file, on any day", () => {
    expect(() => assertRunNotMeasured(RUNS, 2)).toThrow(
      "Run 2 is already measured in measurements/citations-run-2-2026-10-05.json. " +
        "Delete or rename that file on purpose to ask run 2 again.",
    );
  });

  it("allows a run whose only file is aborted", () => {
    const aborted = runFile(2, "2026-10-05T17:00:00.000Z", { aborted: true });
    expect(() => assertRunNotMeasured([RUNS[0], aborted], 2)).not.toThrow();
  });
});

describe("quotaFreeAt", () => {
  // The limiter's windows are UTC clock hours, and the previous hour still counts, weighted by
  // how much of it overlaps the last hour (Upstash slidingWindow).
  it("is the start of the second UTC hour after the last request of any run", () => {
    const aborted = runFile(2, "2026-10-05T17:00:00.000Z", {
      aborted: true,
      lastRequestAt: "2026-10-05T17:03:10.000Z",
    });
    expect(quotaFreeAt([RUNS[0], aborted])).toBe("2026-10-05T19:00:00.000Z");
    expect(quotaFreeAt([RUNS[0]])).toBe("2026-10-05T16:00:00.000Z");
  });

  it("is null before any request", () => {
    expect(quotaFreeAt([])).toBeNull();
    expect(quotaFreeAt([runFile(1, "2026-10-05T14:00:00.000Z", { lastRequestAt: null })])).toBe(
      null,
    );
  });
});

describe("aggregateRuns", () => {
  it("joins the three runs of one set into one measurement, in the set's order", () => {
    const measurement = aggregateRuns([RUNS[2], RUNS[0], RUNS[1]], SET);

    expect(measurement).toEqual({
      date: "2026-10-06T09:00:00.000Z",
      aborted: false,
      url: "https://rag-citations.example.com",
      model: "openai/gpt-6-luna",
      location: "Recife, home fibre",
      questionSet: { path: SET.path, sha256: SET.sha256, questions: 40 },
      runs: RUNS.map(({ file, record }) => ({
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
      answers: IDS.map(answer),
      summary: summarizeAnswers(IDS.map(answer)),
    });
  });

  it("ignores aborted runs", () => {
    const aborted = runFile(2, "2026-10-05T16:00:00.000Z", { aborted: true, answers: [] });
    expect(aggregateRuns([...RUNS, aborted], SET)).toEqual(aggregateRuns(RUNS, SET));
  });

  it("refuses a missing run, and two good files of one run", () => {
    expect(() => aggregateRuns(RUNS.slice(0, 2), SET)).toThrow(
      "Run 3 has no good file yet: ask it with MEASURE_RUN=3.",
    );
    const again = runFile(2, "2026-10-07T09:00:00.000Z");
    expect(() => aggregateRuns([...RUNS, again], SET)).toThrow(
      "Run 2 has 2 good files: measurements/citations-run-2-2026-10-05.json, " +
        "measurements/citations-run-2-2026-10-07.json. Keep one.",
    );
  });

  it("refuses runs of another version of the set", () => {
    const changed = runFile(2, "2026-10-05T17:00:00.000Z", {
      questionSet: { path: SET.path, sha256: "b".repeat(64) },
    });
    expect(() => aggregateRuns([RUNS[0], changed, RUNS[2]], SET)).toThrow(
      "Run 2 asked another version of measurements/questions.json (sha256 bbbbbbbbbbbb…).",
    );
  });

  it("refuses a run that did not ask exactly its questions", () => {
    const short = runFile(3, "2026-10-06T09:00:00.000Z", {
      answers: runQuestions(IDS, 3).slice(1).map(answer),
    });
    expect(() => aggregateRuns([RUNS[0], RUNS[1], short], SET)).toThrow(
      "Run 3 did not answer exactly its questions, m28 to m40.",
    );
  });

  it("refuses runs against another URL, model or location", () => {
    for (const field of ["url", "model", "location"] as const) {
      const other = runFile(3, "2026-10-06T09:00:00.000Z", { [field]: "other" });
      expect(() => aggregateRuns([RUNS[0], RUNS[1], other], SET), field).toThrow(
        `Run 3 has another ${field} than run 1: other.`,
      );
    }
  });
});
