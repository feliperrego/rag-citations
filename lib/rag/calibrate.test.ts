import { describe, expect, it } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import {
  assertRealMode,
  type CalibrationReport,
  calibrate,
  checkPrompts,
  fitThreshold,
  formatReport,
  type PromptScore,
  type ScoredQuestion,
} from "./calibrate";

// Synthetic best-passage scores. The expected thresholds were worked out by hand: every candidate
// is the midpoint of a gap between two adjacent scores, with -1 and 1 closing the outer gaps.
function answerable(score: number, language: Locale = "en"): ScoredQuestion {
  return { id: `${language} answerable ${score}`, language, answerable: true, score };
}

function outOfScope(score: number, language: Locale = "en"): ScoredQuestion {
  return { id: `${language} out of scope ${score}`, language, answerable: false, score };
}

// Spec §8 rules 1, 2 and 4, for one group of questions.
describe("fitThreshold", () => {
  it("separates at the midpoint of the lowest answerable and the highest out-of-scope score", () => {
    const fit = fitThreshold([
      answerable(0.81),
      outOfScope(0.2),
      answerable(0.62),
      outOfScope(0.48),
      answerable(0.7),
      outOfScope(0.35),
    ]);
    expect(fit.threshold).toBeCloseTo(0.55, 12);
    expect(fit.errors).toEqual([]);
  });

  it("does not separate an answerable and an out-of-scope question with the same score", () => {
    // Rule 1: answerable questions need score >= t and out-of-scope ones score < t.
    const same = outOfScope(0.5);
    const fit = fitThreshold([answerable(0.5), same]);
    expect(fit.errors).toEqual([same]);
    // Refusing neither and refusing both tie; the lower threshold wins.
    expect(fit.threshold).toBeCloseTo(-0.25, 12);
  });

  it("takes the threshold that misclassifies the fewest questions when none separates", () => {
    const low = answerable(0.3);
    const fit = fitThreshold([
      low,
      answerable(0.6),
      answerable(0.7),
      answerable(0.8),
      outOfScope(0.2),
      outOfScope(0.4),
      outOfScope(0.5),
    ]);
    expect(fit.threshold).toBeCloseTo(0.55, 12);
    expect(fit.errors).toEqual([low]);
  });

  it("takes the lowest of the thresholds that misclassify equally few", () => {
    // 0.55 and 0.675 both misclassify two questions.
    const low = answerable(0.3);
    const high = outOfScope(0.65);
    const fit = fitThreshold([
      low,
      answerable(0.6),
      answerable(0.7),
      answerable(0.8),
      outOfScope(0.2),
      outOfScope(0.4),
      outOfScope(0.5),
      high,
    ]);
    expect(fit.threshold).toBeCloseTo(0.55, 12);
    expect(fit.errors).toEqual([low, high]);
  });

  it("closes the gap below every score with -1, cosine's lowest value", () => {
    // Refusing nothing and refusing everything each misclassify two; the lower wins.
    const fit = fitThreshold([answerable(0.1), answerable(0.2), outOfScope(0.3), outOfScope(0.4)]);
    expect(fit.threshold).toBeCloseTo(-0.45, 12);
    expect(fit.errors.map(({ score }) => score)).toEqual([0.3, 0.4]);
  });

  it("closes the gap above every score with 1, cosine's highest value", () => {
    // Refusing everything misclassifies one question, fewer than any other threshold.
    const fit = fitThreshold([answerable(0.1), outOfScope(0.2), outOfScope(0.3)]);
    expect(fit.threshold).toBeCloseTo(0.65, 12);
    expect(fit.errors.map(({ score }) => score)).toEqual([0.1]);
  });

  it("needs at least one answerable and one out-of-scope question", () => {
    expect(() => fitThreshold([answerable(0.5), answerable(0.6)])).toThrow(
      /answerable and out-of-scope questions/,
    );
    expect(() => fitThreshold([outOfScope(0.5)])).toThrow(/answerable and out-of-scope questions/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1, 1.2])(
    "rejects the score %d, which is not a cosine strictly between -1 and 1",
    (score) => {
      expect(() => fitThreshold([answerable(0.5), outOfScope(score)])).toThrow(RangeError);
    },
  );
});

// Spec §8 rules 2 to 4, over both languages (R-18, S-06).
describe("calibrate", () => {
  it("uses one threshold when it separates the EN and PT questions together (rule 2)", () => {
    const calibration = calibrate([
      answerable(0.6),
      answerable(0.7),
      outOfScope(0.3),
      outOfScope(0.4),
      answerable(0.55, "pt-BR"),
      answerable(0.65, "pt-BR"),
      outOfScope(0.2, "pt-BR"),
      outOfScope(0.45, "pt-BR"),
    ]);
    expect(calibration.perLanguage).toBe(false);
    expect(calibration.threshold).toBeCloseTo(0.5, 12);
    expect(calibration.together.errors).toEqual([]);
  });

  it("keys one threshold per interface language when none separates both (rule 3)", () => {
    const enOutOfScope = [outOfScope(0.45), outOfScope(0.5)];
    const calibration = calibrate([
      answerable(0.6),
      answerable(0.7),
      ...enOutOfScope,
      answerable(0.4, "pt-BR"),
      answerable(0.42, "pt-BR"),
      outOfScope(0.2, "pt-BR"),
      outOfScope(0.3, "pt-BR"),
    ]);
    if (!calibration.perLanguage) throw new Error("expected one threshold per language");
    expect(calibration.threshold.en).toBeCloseTo(0.55, 12);
    expect(calibration.threshold["pt-BR"]).toBeCloseTo(0.35, 12);
    expect(calibration.languages.en.errors).toEqual([]);
    expect(calibration.languages["pt-BR"].errors).toEqual([]);
    // The best single threshold, which the report prints: it misclassifies two.
    expect(calibration.together.threshold).toBeCloseTo(0.35, 12);
    expect(calibration.together.errors).toEqual(enOutOfScope);
  });

  it("takes the fewest misclassified for a language that still does not separate (rule 4)", () => {
    const ptHigh = outOfScope(0.4, "pt-BR");
    const calibration = calibrate([
      answerable(0.6),
      answerable(0.7),
      outOfScope(0.45),
      outOfScope(0.5),
      answerable(0.3, "pt-BR"),
      answerable(0.5, "pt-BR"),
      outOfScope(0.2, "pt-BR"),
      ptHigh,
    ]);
    if (!calibration.perLanguage) throw new Error("expected one threshold per language");
    expect(calibration.threshold.en).toBeCloseTo(0.55, 12);
    expect(calibration.languages.en.errors).toEqual([]);
    // 0.25 and 0.45 both misclassify one PT question; the lower wins.
    expect(calibration.threshold["pt-BR"]).toBeCloseTo(0.25, 12);
    expect(calibration.languages["pt-BR"].errors).toEqual([ptHigh]);
  });

  it("needs answerable and out-of-scope questions in each language", () => {
    const en = [answerable(0.6), outOfScope(0.3)];
    expect(() => calibrate([...en, answerable(0.5, "pt-BR")])).toThrow(/pt-BR/);
    expect(() => calibrate([...en, outOfScope(0.1, "pt-BR")])).toThrow(/pt-BR/);
    expect(() => calibrate(en)).toThrow(/pt-BR/);
  });
});

// scripts/calibrate.ts measures the real index only (spec §8).
describe("assertRealMode", () => {
  it("refuses to calibrate in mock mode", () => {
    expect(() => assertRealMode({ AI_MOCK: "1" })).toThrow(/mock mode/);
  });

  it.each([{}, { AI_MOCK: "0" }, { AI_MOCK: "" }])("lets %j calibrate", (env) => {
    expect(() => assertRealMode(env)).not.toThrow();
  });
});

function prompt(language: Locale, inScope: boolean, score: number): PromptScore {
  return { language, prompt: `${language} ${inScope ? "in" : "out"} ${score}`, inScope, score };
}

// Each suggested prompt against the threshold (spec §8, S-28).
describe("checkPrompts", () => {
  it("expects in-scope prompts at or above the threshold and the out-of-scope one below", () => {
    const prompts = [
      prompt("en", true, 0.5),
      prompt("en", true, 0.45),
      prompt("en", true, 0.44),
      prompt("en", false, 0.3),
      prompt("en", false, 0.45),
    ];
    expect(checkPrompts(prompts, 0.45).map(({ ok }) => ok)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
  });

  it("checks each prompt against its interface language's threshold", () => {
    const checks = checkPrompts(
      [prompt("en", true, 0.35), prompt("pt-BR", true, 0.35), prompt("pt-BR", false, 0.3)],
      { en: 0.45, "pt-BR": 0.3 },
    );
    expect(checks.map(({ threshold, ok }) => ({ threshold, ok }))).toEqual([
      { threshold: 0.45, ok: false },
      { threshold: 0.3, ok: true },
      { threshold: 0.3, ok: false },
    ]);
  });
});

describe("formatReport", () => {
  const questions = [
    { ...answerable(0.6), question: "How do I stream text?" },
    { ...answerable(0.7), question: "How do I call tools?" },
    { ...outOfScope(0.45), question: "How do I center a div?" },
    { ...outOfScope(0.5), question: "How do I fine-tune a model?" },
    { ...answerable(0.3, "pt-BR"), question: "Como faço streaming de texto?" },
    { ...answerable(0.5, "pt-BR"), question: "Como chamo ferramentas?" },
    { ...outOfScope(0.2, "pt-BR"), question: "Como centralizo uma div?" },
    { ...outOfScope(0.4, "pt-BR"), question: "Como faço fine-tuning?" },
  ];
  const calibration = calibrate(questions);

  function report(overrides: Partial<CalibrationReport> = {}): string {
    return formatReport({
      model: "test/embedding-model",
      dimensions: 3,
      fileHash: "f".repeat(64),
      date: "2026-10-02",
      tokens: 120,
      questions,
      calibration,
      frozen: null,
      prompts: checkPrompts([prompt("en", true, 0.6), prompt("pt-BR", false, 0.3)], {
        en: 0.55,
        "pt-BR": 0.25,
      }),
      ...overrides,
    });
  }

  it("lists every question's score, highest first", () => {
    const lines = report().split("\n");
    const scores = lines.filter((line) => /^ {2}0\.\d{4} {2}/.test(line));
    expect(scores).toHaveLength(questions.length);
    expect(scores[0]).toMatch(/^ {2}0\.7000 {2}en {5}answerable {4}en answerable 0\.7 +How do I/);
    expect(scores.at(-1)).toMatch(/0\.2000 {2}pt-BR {2}out of scope {2}.*Como centralizo/);
  });

  it("states the rule that chose the threshold and the questions it misclassifies", () => {
    const text = report();
    expect(text).toContain("Rule 3: no single threshold separates the EN and PT questions");
    expect(text).toContain("en     rule 2: 0.55 separates the en questions.");
    expect(text).toContain(
      "pt-BR  rule 4: 0.25 misclassifies 1: pt-BR out of scope 0.4 (out of scope, 0.4000).",
    );
  });

  it("prints the value to freeze, with the date and the calibration file's hash", () => {
    const text = report();
    expect(text).toContain(
      `Calibrated on 2026-10-02 with calibration/questions.json, sha256 ${"f".repeat(64)}.`,
    );
    expect(text).toContain(
      'export const REFUSAL_THRESHOLD: RefusalThreshold | null = { en: 0.55, "pt-BR": 0.25 };',
    );
  });

  it("flags a suggested prompt on the wrong side, and never moves the threshold", () => {
    const prompts = checkPrompts([prompt("en", true, 0.5), prompt("pt-BR", false, 0.5)], 0.45);
    const text = report({ frozen: 0.45, prompts });
    expect(text).toContain("REFUSAL_THRESHOLD is frozen at 0.45");
    expect(text).not.toContain("export const REFUSAL_THRESHOLD");
    expect(text).toContain("  ok     en     answer  0.5000 >= 0.45  en in 0.5");
    expect(text).toContain("  WRONG  pt-BR  refuse  0.5000 >= 0.45  pt-BR out 0.5");
    expect(text).toContain("1 suggested prompt is on the wrong side");
  });

  it("prints one threshold for both languages when rule 2 applies", () => {
    const separable = calibrate([
      answerable(0.6),
      outOfScope(0.4),
      answerable(0.55, "pt-BR"),
      outOfScope(0.45, "pt-BR"),
    ]);
    const text = report({ calibration: separable });
    expect(text).toContain("Rule 2: 0.5 separates the EN and PT questions together (spec §8).");
    expect(text).toContain("export const REFUSAL_THRESHOLD: RefusalThreshold | null = 0.5;");
  });
});
