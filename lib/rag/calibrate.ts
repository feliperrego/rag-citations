import { LOCALES, type Locale } from "@/lib/i18n/locale";
import type { RefusalThreshold } from "./config";
import { thresholdFor } from "./refusal";

/** The calibration set (spec §8), relative to the repo root. */
export const CALIBRATION_PATH = "calibration/questions.json";

/** The passage that answers a question, and a phrase copied from its text as evidence. */
export type QuestionSource = { file: string; heading: string; evidence: string };

/** A question of the calibration set, typed in its interface language. */
export type CalibrationQuestion = { id: string; language: Locale; question: string } & (
  | ({ answerable: true } & QuestionSource)
  /** A near-miss: an AI or web topic the docs do not cover, named by terms the corpus lacks. */
  | { answerable: false; notInCorpus: string[] }
);

/** calibration/questions.json. */
export type CalibrationSet = { about: string; questions: CalibrationQuestion[] };

/** A calibration question and its best passage's score, the gate's topScore (spec §8). */
export type ScoredQuestion = { id: string; language: Locale; answerable: boolean; score: number };

/** A threshold for a group of questions, and the questions it puts on the wrong side. */
export type Fit = {
  threshold: number;
  /**
   * Answerable questions scoring below the threshold and out-of-scope ones scoring at or above
   * it, in input order. Empty when the threshold separates the group (spec §8 rule 1).
   */
  errors: ScoredQuestion[];
};

/** The calibration's result: `threshold` is the value to freeze as REFUSAL_THRESHOLD. */
export type Calibration =
  /** Rule 2: one threshold separates the EN and PT questions together. */
  | { perLanguage: false; threshold: number; together: Fit }
  /**
   * Rule 3, with rule 4 for a language that does not separate. `together` is the best single
   * threshold, which misclassifies at least one question.
   */
  | {
      perLanguage: true;
      threshold: Record<Locale, number>;
      together: Fit;
      languages: Record<Locale, Fit>;
    };

// A cosine score lies in [-1, 1], so these two close the gaps below and above every score.
const COSINE_MIN = -1;
const COSINE_MAX = 1;

function hasBothKinds(questions: readonly ScoredQuestion[]): boolean {
  return questions.some((q) => q.answerable) && questions.some((q) => !q.answerable);
}

/** Rule 1: the gate refuses when the best score is below the threshold. */
function misclassified(questions: readonly ScoredQuestion[], threshold: number): ScoredQuestion[] {
  return questions.filter(({ answerable, score }) =>
    answerable ? score < threshold : score >= threshold,
  );
}

/**
 * Rules 2 and 4 for one group of questions (spec §8, S-06). The number of misclassified
 * questions changes only at a score, so each gap between two adjacent scores is one candidate,
 * taken at its midpoint. The candidate with the fewest errors wins, and the lowest on ties, since
 * the model is the second layer. When a threshold separates the group, the one gap without errors
 * lies between the highest out-of-scope and the lowest answerable score, so this is rule 2.
 */
export function fitThreshold(questions: readonly ScoredQuestion[]): Fit {
  if (!hasBothKinds(questions)) {
    throw new Error("A threshold needs answerable and out-of-scope questions (spec §8)");
  }
  for (const { id, score } of questions) {
    if (!(score > COSINE_MIN && score < COSINE_MAX)) {
      throw new RangeError(`${id} scores ${score}, not a cosine strictly between -1 and 1`);
    }
  }

  const scores = [...new Set(questions.map(({ score }) => score))].sort((a, b) => a - b);
  const bounds = [COSINE_MIN, ...scores, COSINE_MAX];
  return bounds
    .slice(1)
    .map((upper, i) => (bounds[i] + upper) / 2)
    .map((threshold) => ({ threshold, errors: misclassified(questions, threshold) }))
    .reduce((best, fit) => (fit.errors.length < best.errors.length ? fit : best));
}

function perLanguage<T>(value: (language: Locale) => T): Record<Locale, T> {
  const entries = LOCALES.map((language) => [language, value(language)] as const);
  return Object.fromEntries(entries) as Record<Locale, T>;
}

/**
 * The calibration rule of spec §8 (R-18, S-06), fixed before any score was seen. Questions are
 * assumed to be typed in the interface language, so per-language thresholds are keyed by it.
 */
export function calibrate(questions: readonly ScoredQuestion[]): Calibration {
  const groups = perLanguage((language) => questions.filter((q) => q.language === language));
  for (const language of LOCALES) {
    if (!hasBothKinds(groups[language])) {
      throw new Error(
        `The calibration needs answerable and out-of-scope ${language} questions (spec §8)`,
      );
    }
  }

  const together = fitThreshold(questions);
  if (together.errors.length === 0) {
    return { perLanguage: false, threshold: together.threshold, together };
  }
  const languages = perLanguage((language) => fitThreshold(groups[language]));
  const threshold = perLanguage((language) => languages[language].threshold);
  return { perLanguage: true, threshold, together, languages };
}

/**
 * The calibration measures the real index, so scripts/calibrate.ts refuses to run in mock mode
 * (spec §8): mock scores say nothing about the real threshold.
 */
export function assertRealMode(env: Readonly<Record<string, string | undefined>>): void {
  if (env.AI_MOCK === "1") {
    throw new Error(
      "The calibration measures the real index, so it refuses to run in mock mode. " +
        "Unset AI_MOCK (spec §8).",
    );
  }
}

/** A suggested prompt's best-passage score. */
export type PromptScore = { language: Locale; prompt: string; inScope: boolean; score: number };

/** The prompt against its interface language's threshold; ok when the gate treats it as meant. */
export type PromptCheck = PromptScore & { threshold: number; ok: boolean };

/**
 * Checks each suggested prompt against the threshold (spec §8, S-28): an in-scope prompt must pass
 * the gate and the out-of-scope one must be refused. A prompt on the wrong side is reworded and
 * approved again (S-02); the threshold never moves.
 */
export function checkPrompts(
  prompts: readonly PromptScore[],
  threshold: RefusalThreshold,
): PromptCheck[] {
  return prompts.map((prompt) => {
    const promptThreshold = thresholdFor(threshold, prompt.language);
    const passes = prompt.score >= promptThreshold;
    return { ...prompt, threshold: promptThreshold, ok: passes === prompt.inScope };
  });
}

/** What scripts/calibrate.ts prints. */
export type CalibrationReport = {
  model: string;
  dimensions: number;
  /** The SHA-256 of calibration/questions.json, recorded with the frozen value (spec §8). */
  fileHash: string;
  /** The UTC day of the run, YYYY-MM-DD. */
  date: string;
  /** The tokens of the one embedMany call, questions and prompts together. */
  tokens: number;
  questions: readonly (ScoredQuestion & { question: string })[];
  calibration: Calibration;
  /** REFUSAL_THRESHOLD as lib/rag/config.ts holds it; null until it is frozen. */
  frozen: RefusalThreshold | null;
  prompts: readonly PromptCheck[];
};

const formatScore = (score: number) => score.toFixed(4);
const kindOf = (answerable: boolean) => (answerable ? "answerable" : "out of scope");
const KIND_WIDTH = kindOf(false).length;
const LANGUAGE_WIDTH = Math.max(...LOCALES.map((language) => language.length));

/** The threshold as TypeScript source, for lib/rag/config.ts. */
function thresholdSource(threshold: RefusalThreshold): string {
  if (typeof threshold === "number") return String(threshold);
  const key = (language: Locale) => (/^\w+$/.test(language) ? language : `"${language}"`);
  const entries = LOCALES.map((language) => `${key(language)}: ${threshold[language]}`);
  return `{ ${entries.join(", ")} }`;
}

function describeFit({ threshold, errors }: Fit, group: string): string {
  if (errors.length === 0) return `${threshold} separates the ${group} questions`;
  const listed = errors.map((q) => `${q.id} (${kindOf(q.answerable)}, ${formatScore(q.score)})`);
  return `${threshold} misclassifies ${errors.length}: ${listed.join(", ")}`;
}

function ruleLines(calibration: Calibration): string[] {
  const { together } = calibration;
  if (!calibration.perLanguage) {
    return [`Rule 2: ${describeFit(together, "EN and PT")} together (spec §8).`];
  }
  return [
    "Rule 3: no single threshold separates the EN and PT questions; the best, " +
      `${together.threshold}, misclassifies ${together.errors.length} (spec §8).`,
    ...LOCALES.map((language) => {
      const fit = calibration.languages[language];
      const rule = fit.errors.length === 0 ? 2 : 4;
      return `  ${language.padEnd(LANGUAGE_WIDTH)}  rule ${rule}: ${describeFit(fit, language)}.`;
    }),
  ];
}

/**
 * The calibration's printout (spec §8): every question's score, the score range of each language
 * and kind, the rule applied and its threshold, how to freeze it, and each suggested prompt
 * against the threshold (S-28).
 */
export function formatReport(report: CalibrationReport): string {
  const { questions, calibration, frozen, prompts } = report;
  const idWidth = Math.max(...questions.map(({ id }) => id.length));
  const byScore = [...questions].sort((a, b) => b.score - a.score);
  const ranges = LOCALES.flatMap((language) =>
    [true, false].map((answerable) => {
      const scores = questions
        .filter((q) => q.language === language && q.answerable === answerable)
        .map(({ score }) => score);
      return (
        `  ${language.padEnd(LANGUAGE_WIDTH)}  ${kindOf(answerable).padEnd(KIND_WIDTH)}  ` +
        `n=${scores.length}  min ${formatScore(Math.min(...scores))}  ` +
        `max ${formatScore(Math.max(...scores))}`
      );
    }),
  );
  const thresholdWidth = Math.max(...prompts.map(({ threshold }) => String(threshold).length));
  const wrong = prompts.filter(({ ok }) => !ok).length;

  return [
    `Index:        ${report.model}, ${report.dimensions} dimensions`,
    `Calibration:  ${CALIBRATION_PATH}, sha256 ${report.fileHash}`,
    `Embedded:     ${questions.length} questions and ${prompts.length} prompts in one call, ` +
      `${report.tokens} tokens`,
    "",
    "Best-passage score of each question, highest first:",
    ...byScore.map(
      (q) =>
        `  ${formatScore(q.score)}  ${q.language.padEnd(LANGUAGE_WIDTH)}  ` +
        `${kindOf(q.answerable).padEnd(KIND_WIDTH)}  ${q.id.padEnd(idWidth)}  ${q.question}`,
    ),
    "",
    "Score range by language and kind:",
    ...ranges,
    "",
    ...ruleLines(calibration),
    "",
    ...(frozen === null
      ? [
          "To freeze it, set it in lib/rag/config.ts, with this line in its comment (spec §8):",
          `  Calibrated on ${report.date} with ${CALIBRATION_PATH}, sha256 ${report.fileHash}.`,
          "  export const REFUSAL_THRESHOLD: RefusalThreshold | null = " +
            `${thresholdSource(calibration.threshold)};`,
        ]
      : [
          `REFUSAL_THRESHOLD is frozen at ${thresholdSource(frozen)} in lib/rag/config.ts, ` +
            "and the prompts are checked against it (S-28).",
        ]),
    "",
    `Suggested prompts against the ${frozen === null ? "threshold above" : "frozen threshold"}:`,
    ...prompts.map(
      (p) =>
        `  ${(p.ok ? "ok" : "WRONG").padEnd(5)}  ${p.language.padEnd(LANGUAGE_WIDTH)}  ` +
        `${p.inScope ? "answer" : "refuse"}  ${formatScore(p.score)} ` +
        `${p.score >= p.threshold ? ">=" : "< "} ${String(p.threshold).padEnd(thresholdWidth)}  ` +
        p.prompt,
    ),
    wrong === 0
      ? "Every suggested prompt is on the right side."
      : `${wrong} suggested prompt${wrong === 1 ? " is" : "s are"} on the wrong side: reword ` +
        `${wrong === 1 ? "it" : "each one"} and have it approved again (S-02). ` +
        "The threshold never moves (S-28).",
    "",
  ].join("\n");
}
