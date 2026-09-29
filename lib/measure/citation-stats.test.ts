import { describe, expect, it } from "vitest";
import {
  type AnswerRecord,
  BOOTSTRAP,
  bootstrapInterval,
  type CitationMeasurement,
  type CitationResult,
  type Classification,
  createRandom,
  median,
  quantile,
  readmeLines,
  summarizeAnswers,
  wholePercent,
} from "./citation-stats";

const VERIFIED: CitationResult = {
  type: "citation",
  n: 1,
  quote: "a quote of words",
  status: "verified",
};
const NOT_FOUND: CitationResult = { ...VERIFIED, n: 2, status: "not-found" };
const UNKNOWN: CitationResult = { ...VERIFIED, n: 6, status: "unknown-source" };
const MALFORMED: CitationResult = { type: "malformed", raw: "[2]", status: "malformed" };

/** A finished answer to one measurement question, in scope unless said otherwise. */
function answer(
  id: string,
  classification: Classification,
  citations: CitationResult[] = [],
  searchMs = 0.3,
  inScope = true,
): AnswerRecord {
  const refused = classification === "gate-refusal";
  return {
    id,
    question: `Question ${id}?`,
    inScope,
    askedAt: "2026-10-05T14:00:00.000Z",
    classification,
    answer: `Answer ${id}.`,
    citations,
    finishReason: "stop",
    topScore: 0.5,
    threshold: 0.3,
    searchMs,
    usage: refused ? null : { inputTokens: 2300, outputTokens: 150, totalTokens: 2450 },
    sources: [],
  };
}

describe("median", () => {
  it("takes the middle value of an odd count and the mean of the two middle ones otherwise", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not reorder its input, and rejects an empty list", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
    expect(() => median([])).toThrow(RangeError);
  });
});

describe("createRandom", () => {
  it("is mulberry32: seed 1 gives the reference implementation's first values", () => {
    const random = createRandom(1);
    expect([random(), random(), random()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it("repeats a sequence for a seed, stays in [0, 1), and differs between seeds", () => {
    const a = createRandom(BOOTSTRAP.seed);
    const b = createRandom(BOOTSTRAP.seed);
    const values = Array.from({ length: 10_000 }, () => a());
    expect(Array.from({ length: 10_000 }, () => b())).toEqual(values);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(createRandom(BOOTSTRAP.seed + 1)()).not.toBe(values[0]);
  });
});

describe("quantile", () => {
  it("interpolates linearly between order statistics, as numpy's default percentile does", () => {
    const sorted = [1, 2, 3, 4];
    expect(quantile(sorted, 0)).toBe(1);
    expect(quantile(sorted, 0.25)).toBe(1.75);
    expect(quantile(sorted, 0.5)).toBe(2.5);
    expect(quantile(sorted, 1)).toBe(4);
  });

  it("rejects an empty list and a probability outside [0, 1]", () => {
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1], 1.01)).toThrow(RangeError);
    expect(() => quantile([1], -0.01)).toThrow(RangeError);
  });
});

describe("bootstrapInterval (S-20)", () => {
  const options = { resamples: 1000, seed: BOOTSTRAP.seed, level: 0.95 };

  it("resamples whole answers, not citations: 10 of 10 and 0 of 10 give 0 to 1", () => {
    // Over citations, 10 of 20 would give about 0.28 to 0.72. Resampling the two answers gives
    // only the rates 0, 0.5 and 1, each tail holding about a quarter of the resamples.
    const interval = bootstrapInterval(
      [
        { verified: 10, total: 10 },
        { verified: 0, total: 10 },
      ],
      options,
    );
    expect(interval).toEqual({ low: 0, high: 1 });
  });

  it("gives a point interval when every answer has the same rate", () => {
    expect(
      bootstrapInterval(
        [
          { verified: 3, total: 3 },
          { verified: 2, total: 2 },
        ],
        options,
      ),
    ).toEqual({ low: 1, high: 1 });
    expect(bootstrapInterval([{ verified: 0, total: 4 }], options)).toEqual({ low: 0, high: 0 });
  });

  it("is close to the normal approximation of the ratio's error on a larger sample", () => {
    // 40 answers of 1 to 5 citations, about 70% verified, with the rate varying by answer.
    const tallies = Array.from({ length: 40 }, (_, i) => {
      const total = 1 + (i % 5);
      return { verified: Math.min(total, Math.round(total * 0.7 + ((i * 7) % 3) - 1)), total };
    });
    const verified = tallies.reduce((sum, t) => sum + t.verified, 0);
    const total = tallies.reduce((sum, t) => sum + t.total, 0);
    const rate = verified / total;
    // The linearised standard error of a ratio estimator over clusters.
    const n = tallies.length;
    const squares = tallies.reduce((sum, t) => sum + (t.verified - rate * t.total) ** 2, 0);
    const se = Math.sqrt((n / (n - 1)) * squares) / total;

    const { low, high } = bootstrapInterval(tallies, options);

    expect(low).toBeLessThan(rate);
    expect(high).toBeGreaterThan(rate);
    expect(Math.abs(low - (rate - 1.96 * se))).toBeLessThan(0.02);
    expect(Math.abs(high - (rate + 1.96 * se))).toBeLessThan(0.02);
  });

  it("is reproducible: the same seed gives the same interval, and another seed another one", () => {
    const tallies = [
      { verified: 3, total: 4 },
      { verified: 2, total: 2 },
      { verified: 1, total: 3 },
      { verified: 5, total: 5 },
      { verified: 2, total: 3 },
    ];
    const interval = bootstrapInterval(tallies, options);
    expect(bootstrapInterval(tallies, options)).toEqual(interval);
    expect(bootstrapInterval(tallies, { ...options, seed: options.seed + 1 })).not.toEqual(
      interval,
    );
  });

  it("rejects no answers, and an answer without citations", () => {
    expect(() => bootstrapInterval([], options)).toThrow(RangeError);
    expect(() => bootstrapInterval([{ verified: 0, total: 0 }], options)).toThrow(RangeError);
  });
});

describe("wholePercent", () => {
  it("rounds a share to a whole percent", () => {
    expect(wholePercent(0.964)).toBe(96);
    expect(wholePercent(0.965)).toBe(97);
    expect(wholePercent(1)).toBe(100);
    expect(wholePercent(0)).toBe(0);
  });

  it("never rounds a share below 1 up to 100, or a share above 0 down to 0", () => {
    expect(wholePercent(0.996)).toBe(99);
    expect(wholePercent(0.004)).toBe(1);
  });
});

describe("summarizeAnswers", () => {
  const answers = [
    answer("m01", "answered-with-citations", [VERIFIED, VERIFIED], 0.25),
    answer("m02", "answered-with-citations", [VERIFIED, NOT_FOUND, MALFORMED], 1),
    answer("m03", "answered-without-citations", [], 0.5),
    answer("m04", "gate-refusal", [], 0.125),
    answer("m05", "model-refusal", [], 0.75),
    answer("m06", "answered-with-citations", [UNKNOWN, VERIFIED], 1.5),
  ];

  it("classifies every question, and rates the attempts of the answered ones (S-12)", () => {
    const summary = summarizeAnswers(answers);

    expect(summary.questions).toBe(6);
    expect(summary.classifications).toEqual({
      "gate-refusal": 1,
      "model-refusal": 1,
      "answered-with-citations": 3,
      "answered-without-citations": 1,
    });
    // 4 verified of 7 attempts, the malformed and the unknown source included.
    expect(summary).toMatchObject({ answersWithCitations: 3, attempts: 7, verified: 4 });
    expect(summary.rate).toBe(4 / 7);
    expect(summary.statuses).toEqual({
      verified: 4,
      "not-found": 1,
      "unknown-source": 1,
      malformed: 1,
    });
  });

  it("takes the interval over the answers with citations, with the pinned bootstrap", () => {
    const summary = summarizeAnswers(answers);

    expect(summary.interval).toEqual({
      ...BOOTSTRAP,
      ...bootstrapInterval(
        [
          { verified: 2, total: 2 },
          { verified: 1, total: 3 },
          { verified: 1, total: 2 },
        ],
        BOOTSTRAP,
      ),
    });
    expect(BOOTSTRAP).toMatchObject({ resamples: 1000, level: 0.95 });
  });

  it("lists as failures the refusals, the answers without citations, and unverified quotes", () => {
    expect(summarizeAnswers(answers).failures).toEqual([
      {
        id: "m02",
        inScope: true,
        classification: "answered-with-citations",
        unverified: ["not-found", "malformed"],
      },
      { id: "m03", inScope: true, classification: "answered-without-citations", unverified: [] },
      { id: "m04", inScope: true, classification: "gate-refusal", unverified: [] },
      { id: "m05", inScope: true, classification: "model-refusal", unverified: [] },
      {
        id: "m06",
        inScope: true,
        classification: "answered-with-citations",
        unverified: ["unknown-source"],
      },
    ]);
  });

  it("takes the median search time over every question, refusals included (S-08)", () => {
    expect(summarizeAnswers(answers).medianSearchMs).toBe(0.625);
  });

  it("rejects a measurement with no citation to rate", () => {
    expect(() => summarizeAnswers([answer("m01", "gate-refusal")])).toThrow(RangeError);
  });
});

// Refusal accuracy, the supporting data of S-10: an out-of-scope question should be refused.
describe("summarizeAnswers: refusal accuracy (S-10)", () => {
  const answers = [
    answer("m01", "answered-with-citations", [VERIFIED]),
    answer("m02", "gate-refusal"),
    answer("m41", "gate-refusal", [], 0.3, false),
    answer("m42", "model-refusal", [], 0.3, false),
    answer("m43", "answered-with-citations", [VERIFIED, NOT_FOUND], 0.3, false),
    answer("m44", "answered-without-citations", [], 0.3, false),
  ];

  it("counts the out-of-scope questions refused, by layer, and the in-scope ones refused", () => {
    expect(summarizeAnswers(answers).refusals).toEqual({
      outOfScope: { questions: 4, refused: 2, gate: 1, model: 1 },
      inScope: { questions: 2, refused: 1 },
    });
  });

  it("lists a refused out-of-scope question as no failure, and an answered one as a failure", () => {
    expect(summarizeAnswers(answers).failures).toEqual([
      { id: "m02", inScope: true, classification: "gate-refusal", unverified: [] },
      {
        id: "m43",
        inScope: false,
        classification: "answered-with-citations",
        unverified: ["not-found"],
      },
      { id: "m44", inScope: false, classification: "answered-without-citations", unverified: [] },
    ]);
  });

  it("rates an answered out-of-scope question's citations with the others (spec §11)", () => {
    expect(summarizeAnswers(answers)).toMatchObject({
      answersWithCitations: 2,
      attempts: 3,
      verified: 2,
    });
  });
});

describe("readmeLines", () => {
  const answers = [
    ...Array.from({ length: 36 }, (_, i) =>
      answer(`m${String(i + 1).padStart(2, "0")}`, "answered-with-citations", [
        VERIFIED,
        VERIFIED,
        VERIFIED,
      ]),
    ),
    answer("m37", "answered-with-citations", [VERIFIED, NOT_FOUND, MALFORMED]),
    answer("m38", "answered-without-citations"),
    answer("m39", "gate-refusal", [], 0.28),
    answer("m40", "model-refusal"),
    // The near-misses (S-10): four refused, one answered.
    answer("m41", "gate-refusal", [], 0.3, false),
    answer("m42", "gate-refusal", [], 0.3, false),
    answer("m43", "model-refusal", [], 0.3, false),
    answer("m44", "answered-with-citations", [VERIFIED], 0.3, false),
    answer("m45", "gate-refusal", [], 0.3, false),
  ];
  const run = (n: number, date: string) => ({
    run: n,
    file: `measurements/citations-run-${n}-${date.slice(0, 10)}.json`,
    date,
    commit: "abc1234",
    userAgent: "Mozilla/5.0 (test)",
    browserVersion: "153.0.8010.12",
    platform: "darwin 25.6.0",
    questionIds: [],
    lastRequestAt: date,
  });
  const measurement: CitationMeasurement = {
    date: "2026-10-06T09:00:00.000Z",
    aborted: false,
    url: "https://rag-citations.example.com",
    model: "openai/gpt-6-luna",
    location: "Recife, home fibre",
    questionSet: { path: "measurements/questions.json", sha256: "f".repeat(64), questions: 45 },
    runs: [
      run(1, "2026-10-05T14:00:00.000Z"),
      run(2, "2026-10-05T17:00:00.000Z"),
      run(3, "2026-10-06T09:00:00.000Z"),
    ],
    answers,
    summary: summarizeAnswers(answers),
  };
  const lines = readmeLines(measurement, {
    rawData: "measurements/citations-2026-10-06.json",
    passages: 239,
  });

  it("prints README line 1 with the rate, n, the answers and the interval (spec §11)", () => {
    // 110 of 112 attempts verified; the interval is the pinned bootstrap's.
    const { low, high } = measurement.summary.interval;
    expect(lines.title).toBe(
      "# RAG with Citations — 98% of citations verified verbatim " +
        "(n=112 citations in 38 answers, " +
        `95% CI ${wholePercent(low)}–${wholePercent(high)}%)`,
    );
  });

  it("prints How it's measured: counts, failures, refusal accuracy and the verbatim caveat (S-10, S-11, A-14)", () => {
    expect(lines.howMeasured).toBe(
      "n=112 citations in 38 answers to 45 English questions (5 out of scope), openai/gpt-6-luna, " +
        "measured from Recife, home fibre, 2026-10-05 to 2026-10-06, 3 runs; answers: with " +
        "citations 38, without citations 1 (m38), gate refusal 4 (m39), model refusal 2 (m40); " +
        "refusal accuracy: 4 of 5 out-of-scope refused (gate 3, model 1), answered m44; " +
        "in-scope refused: 2 of 40; citations not verified: not found 1, unknown source 0, " +
        "malformed 1 (m37). A verified quote is in its " +
        "passage word for word, allowing only whitespace, quote style, Unicode form, letter case " +
        "and a Markdown link written as its text; it does not prove that the passage supports " +
        "the claim · " +
        "[raw data](measurements/citations-2026-10-06.json)",
    );
  });

  it("prints the Decisions line with the median search time (S-08)", () => {
    expect(lines.decision).toBe(
      "- **The index is committed to the repo and searched in memory** instead of a vector " +
        "database: a search over its 239 passages took a median 0.3 ms in production (45 " +
        "questions); a database waits for more than ~5,000 vectors or writes at runtime.",
    );
  });

  it("names one day when every run happened on it", () => {
    const sameDay = {
      ...measurement,
      runs: measurement.runs.map((r) => ({ ...r, date: "2026-10-05T14:00:00.000Z" })),
    };
    const { howMeasured } = readmeLines(sameDay, { rawData: "x.json", passages: 239 });
    expect(howMeasured).toContain("measured from Recife, home fibre, 2026-10-05, 3 runs;");
  });

  it("names the first and the last day when the runs span three days", () => {
    const days = ["2026-10-06", "2026-10-05", "2026-10-07"];
    const threeDays = {
      ...measurement,
      runs: measurement.runs.map((r, i) => ({ ...r, date: `${days[i]}T14:00:00.000Z` })),
    };
    const { howMeasured } = readmeLines(threeDays, { rawData: "x.json", passages: 239 });
    expect(howMeasured).toContain(
      "measured from Recife, home fibre, 2026-10-05 to 2026-10-07, 3 runs;",
    );
  });

  it("names no answered out-of-scope question when all were refused", () => {
    const allRefused = answers.map((a) =>
      a.id === "m44" ? { ...a, classification: "gate-refusal" as const, citations: [] } : a,
    );
    const { howMeasured } = readmeLines(
      { ...measurement, answers: allRefused, summary: summarizeAnswers(allRefused) },
      { rawData: "x.json", passages: 239 },
    );
    expect(howMeasured).toContain(
      "refusal accuracy: 5 of 5 out-of-scope refused (gate 4, model 1); in-scope refused: 2 of 40;",
    );
  });
});
