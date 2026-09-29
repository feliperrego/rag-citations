import type { MeasurementMeta } from "@/e2e/helpers/measure";
import type { CitationAttempt } from "@/lib/rag/citations";
import type { Source } from "@/lib/rag/message";
import type { CitationStatus } from "@/lib/rag/verify";
import { measurementDay } from "./record";

/**
 * The records of the citation measurement and the statistics published from them (spec §11).
 * e2e/citations.measure.ts writes one record per run; scripts/aggregate-citations.ts joins the
 * runs and prints the README lines, so no number is typed by hand (template §7.5).
 */

/** How a finished answer ended (spec §11). */
export const CLASSIFICATIONS = [
  "gate-refusal",
  "model-refusal",
  "answered-with-citations",
  "answered-without-citations",
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

const STATUSES = ["verified", "not-found", "unknown-source", "malformed"] as const;

/** One citation attempt of an answer, with the status the page showed (spec §6.3, S-12). */
export type CitationResult = CitationAttempt & { status: CitationStatus };

/** The tokens of the answer's model call; null when the provider did not report a count. */
export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

/** A retrieved passage without its text, which is chunk.text in corpus/index.json. */
export type SourceRef = Omit<Source, "text">;

/** One measurement question and its finished answer. */
export type AnswerRecord = {
  id: string;
  question: string;
  /**
   * Whether the docs answer the question (measurements/questions.json). Refusing an
   * out-of-scope question is the correct answer (S-10).
   */
  inScope: boolean;
  /** When the question was sent, ISO 8601 in UTC. */
  askedAt: string;
  classification: Classification;
  /** The answer's text, markers included. */
  answer: string;
  /** Every citation attempt, in order. */
  citations: CitationResult[];
  finishReason: string | null;
  topScore: number;
  threshold: number;
  /** The in-memory search, from the message metadata (S-08). */
  searchMs: number;
  /** null for a gate refusal, which calls no model. */
  usage: TokenUsage | null;
  /** The retrieved passages; a gate refusal sends none. */
  sources: SourceRef[];
};

/** The frozen question set a run asked, named by its file's SHA-256. */
export type QuestionSetRef = { path: string; sha256: string };

/** One run's file, measurements/citations-run-<r>-YYYY-MM-DD.json (S-19, U-P4). */
export type CitationRun = MeasurementMeta & {
  aborted: boolean;
  /** Why the run stopped early, or null. */
  abortReason: string | null;
  /** From 1 to runs. */
  run: number;
  runs: number;
  questionSet: QuestionSetRef;
  /** The questions this run asks, in order. */
  questionIds: string[];
  /** The last question sent, even one that failed: the rate limit counts it. */
  lastRequestAt: string | null;
  answers: AnswerRecord[];
};

/** A run as the aggregate lists it, with the file it came from. */
export type RunRef = Pick<
  CitationRun,
  | "run"
  | "date"
  | "commit"
  | "userAgent"
  | "browserVersion"
  | "platform"
  | "questionIds"
  | "lastRequestAt"
> & { file: string };

/** The seeded bootstrap of the interval (S-20). */
export const BOOTSTRAP = { resamples: 1000, seed: 20260928, level: 0.95 } as const;

export type Interval = { low: number; high: number };

/**
 * A question whose answer is not what it should be: an in-scope question refused, uncited, or
 * with unverified quotes; an out-of-scope question answered instead of refused (S-10).
 */
export type Failure = {
  id: string;
  inScope: boolean;
  classification: Classification;
  unverified: CitationStatus[];
};

/**
 * Refusal accuracy, supporting data under "How it's measured" (spec §11, S-10): the out-of-scope
 * questions refused, by layer, and the in-scope questions refused.
 */
export type RefusalSummary = {
  outOfScope: { questions: number; refused: number; gate: number; model: number };
  inScope: { questions: number; refused: number };
};

export type CitationSummary = {
  questions: number;
  classifications: Record<Classification, number>;
  /** The answers with at least one citation attempt, over which the interval resamples. */
  answersWithCitations: number;
  attempts: number;
  verified: number;
  /** verified / attempts, over the answered messages (S-12). */
  rate: number;
  interval: typeof BOOTSTRAP & Interval;
  statuses: Record<CitationStatus, number>;
  refusals: RefusalSummary;
  medianSearchMs: number;
  failures: Failure[];
};

/** The aggregate of every run of the one frozen set, measurements/citations-YYYY-MM-DD.json. */
export type CitationMeasurement = {
  /** The last run's start, which names the file. */
  date: string;
  aborted: false;
  url: string;
  model: string;
  location: string;
  questionSet: QuestionSetRef & { questions: number };
  runs: RunRef[];
  /** Every answer, in the set's order. */
  answers: AnswerRecord[];
  summary: CitationSummary;
};

/** Median of the values; the mean of the two middle values when their count is even. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median() needs at least one value.");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** mulberry32, a small seeded generator of numbers in [0, 1), so the interval can be re-run. */
export function createRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The p-quantile of sorted values, interpolated between order statistics (numpy's default). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError("quantile() needs at least one value.");
  if (!(p >= 0 && p <= 1)) throw new RangeError(`Not a probability: ${p}`);
  const h = (sorted.length - 1) * p;
  const below = Math.floor(h);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (h - below) * (sorted[above] - sorted[below]);
}

/** One answer's citation attempts: how many there were and how many verified. */
export type AnswerTally = { verified: number; total: number };

/**
 * Percentile bootstrap of verified / total, resampling whole answers with replacement, because
 * citations cluster by answer (S-20).
 */
export function bootstrapInterval(
  tallies: readonly AnswerTally[],
  { resamples, seed, level }: { resamples: number; seed: number; level: number },
): Interval {
  if (tallies.length === 0) throw new RangeError("The bootstrap needs at least one answer.");
  if (tallies.some(({ total }) => total < 1)) {
    throw new RangeError("Every answer in the bootstrap needs at least one citation attempt.");
  }
  const random = createRandom(seed);
  const rates: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let verified = 0;
    let total = 0;
    for (let j = 0; j < tallies.length; j++) {
      const tally = tallies[Math.floor(random() * tallies.length)];
      verified += tally.verified;
      total += tally.total;
    }
    rates.push(verified / total);
  }
  rates.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { low: quantile(rates, tail), high: quantile(rates, 1 - tail) };
}

/**
 * A share as a whole percent. A share below 1 never shows 100, and a share above 0 never
 * shows 0, so a rounded headline never claims every or no citation.
 */
export function wholePercent(share: number): number {
  const percent = Math.round(share * 100);
  if (percent === 100 && share < 1) return 99;
  if (percent === 0 && share > 0) return 1;
  return percent;
}

function countBy<K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

function isRefusal(classification: Classification): boolean {
  return classification === "gate-refusal" || classification === "model-refusal";
}

/** Refusal accuracy (S-10): how many questions of each kind were refused, and by which layer. */
function summarizeRefusals(answers: readonly AnswerRecord[]): RefusalSummary {
  const outOfScope = answers.filter(({ inScope }) => !inScope);
  const inScope = answers.filter((answer) => answer.inScope);
  const count = (list: readonly AnswerRecord[], classification: Classification) =>
    list.filter((answer) => answer.classification === classification).length;
  return {
    outOfScope: {
      questions: outOfScope.length,
      refused: outOfScope.filter(({ classification }) => isRefusal(classification)).length,
      gate: count(outOfScope, "gate-refusal"),
      model: count(outOfScope, "model-refusal"),
    },
    inScope: {
      questions: inScope.length,
      refused: inScope.filter(({ classification }) => isRefusal(classification)).length,
    },
  };
}

/**
 * The published statistics (spec §11): each question's classification, and the share of
 * verified citation attempts in the answered messages, with its bootstrap interval. An answer
 * without citations adds no attempt and is listed among the failures (S-12). An out-of-scope
 * question's refusal is correct, not a failure; if it is answered instead, its citations count
 * like any other answer's, and it is a failure (S-10).
 */
export function summarizeAnswers(answers: readonly AnswerRecord[]): CitationSummary {
  const answered = answers.filter(({ classification }) => classification.startsWith("answered"));
  const tallies = answered
    .map(({ citations }) => ({
      verified: citations.filter(({ status }) => status === "verified").length,
      total: citations.length,
    }))
    .filter(({ total }) => total > 0);
  if (tallies.length === 0) throw new RangeError("No answer has a citation: there is no rate.");

  const attempts = tallies.reduce((sum, { total }) => sum + total, 0);
  const verified = tallies.reduce((sum, tally) => sum + tally.verified, 0);
  const failures = answers.flatMap(({ id, inScope, classification, citations }) => {
    const unverified = citations.flatMap(({ status }) => (status === "verified" ? [] : [status]));
    const succeeded = inScope
      ? classification === "answered-with-citations" && unverified.length === 0
      : isRefusal(classification);
    return succeeded ? [] : [{ id, inScope, classification, unverified }];
  });

  return {
    questions: answers.length,
    classifications: countBy(
      CLASSIFICATIONS,
      answers.map(({ classification }) => classification),
    ),
    answersWithCitations: tallies.length,
    attempts,
    verified,
    rate: verified / attempts,
    interval: { ...BOOTSTRAP, ...bootstrapInterval(tallies, BOOTSTRAP) },
    statuses: countBy(
      STATUSES,
      answered.flatMap(({ citations }) => citations.map(({ status }) => status)),
    ),
    refusals: summarizeRefusals(answers),
    medianSearchMs: median(answers.map(({ searchMs }) => searchMs)),
    failures,
  };
}

/** " (m03, m17)" for the failures of one kind, or nothing when there are none. */
function ids(failures: readonly Failure[]): string {
  return failures.length === 0 ? "" : ` (${failures.map(({ id }) => id).join(", ")})`;
}

/** A search time to two significant digits, e.g. 0.31. */
function formatMs(ms: number): string {
  return String(Number(ms.toPrecision(2)));
}

export type ReadmeLines = { title: string; howMeasured: string; decision: string };

/**
 * README line 1, the first line of "How it's measured", and the "Decisions" line on the
 * in-memory index (spec §11, S-08, S-11; template §8). How it's measured carries refusal
 * accuracy as supporting data, never a second headline (S-10).
 */
export function readmeLines(
  measurement: CitationMeasurement,
  { rawData, passages }: { rawData: string; passages: number },
): ReadmeLines {
  const { summary, model, location, runs } = measurement;
  const { attempts, answersWithCitations: answers, interval, classifications: kinds } = summary;
  const { outOfScope, inScope } = summary.refusals;
  const days = [...new Set(runs.map(({ date }) => measurementDay(date)))].sort();
  const span = days.length === 1 ? days[0] : `${days[0]} to ${days.at(-1)}`;
  // An in-scope failure is named under its classification, an out-of-scope one under refusal
  // accuracy, and any answer with unverified quotes under those.
  const failed = (classification: Classification) =>
    summary.failures.filter(
      (failure) => failure.inScope && failure.classification === classification,
    );
  const notRefused = summary.failures.filter((failure) => !failure.inScope);
  const unverified = summary.failures.filter(({ unverified }) => unverified.length > 0);

  const title =
    `# RAG with Citations — ${wholePercent(summary.rate)}% of citations verified verbatim ` +
    `(n=${attempts} citations in ${answers} answers, ${wholePercent(interval.level)}% CI ` +
    `${wholePercent(interval.low)}–${wholePercent(interval.high)}%)`;
  const answered =
    notRefused.length === 0 ? "" : `, answered ${notRefused.map(({ id }) => id).join(", ")}`;
  const howMeasured =
    `n=${attempts} citations in ${answers} answers to ${summary.questions} English questions ` +
    `(${outOfScope.questions} out of scope), ${model}, measured from ${location}, ${span}, ` +
    `${runs.length} runs; answers: with citations ${kinds["answered-with-citations"]}, ` +
    `without citations ${kinds["answered-without-citations"]}` +
    `${ids(failed("answered-without-citations"))}, gate refusal ${kinds["gate-refusal"]}` +
    `${ids(failed("gate-refusal"))}, model refusal ${kinds["model-refusal"]}` +
    `${ids(failed("model-refusal"))}; refusal accuracy: ${outOfScope.refused} of ` +
    `${outOfScope.questions} out-of-scope refused (gate ${outOfScope.gate}, model ` +
    `${outOfScope.model})${answered}; in-scope refused: ${inScope.refused} of ` +
    `${inScope.questions}; citations not verified: ` +
    `not found ${summary.statuses["not-found"]}, unknown source ` +
    `${summary.statuses["unknown-source"]}, malformed ${summary.statuses.malformed}` +
    `${ids(unverified)}. A verified quote is in its passage word for word, allowing only ` +
    "whitespace, quote style, Unicode form, letter case and a Markdown link written as its text; " +
    `it does not prove that the passage supports the claim · [raw data](${rawData})`;
  const decision =
    "- **The index is committed to the repo and searched in memory** instead of a vector " +
    `database: a search over its ${passages} passages took a median ` +
    `${formatMs(summary.medianSearchMs)} ms in production (${summary.questions} questions); ` +
    "a database waits for more than ~5,000 vectors or writes at runtime.";
  return { title, howMeasured, decision };
}
