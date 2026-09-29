import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { MEASUREMENT_SET_PATH, type MeasurementSet } from "@/lib/measure/citation-runs";
import {
  CALIBRATION_PATH,
  type CalibrationQuestion,
  type CalibrationSet,
  type QuestionSource,
} from "@/lib/rag/calibrate";
import { chunkCorpus } from "@/lib/rag/chunk";
import { CORPUS_DIR } from "@/lib/rag/config";
import { readCorpus } from "@/lib/rag/corpus";
import { normalise, verifyQuote } from "@/lib/rag/verify";

const corpus = readCorpus(CORPUS_DIR);
const chunks = chunkCorpus(corpus);
const corpusText = corpus.map(({ content }) => content.toLowerCase());

const calibration = JSON.parse(readFileSync(CALIBRATION_PATH, "utf8")) as CalibrationSet;
const answerable = calibration.questions.filter((q) => q.answerable);
const outOfScope = calibration.questions.filter((q) => !q.answerable);

const measurement = JSON.parse(readFileSync(MEASUREMENT_SET_PATH, "utf8")) as MeasurementSet;
const prompts = LOCALES.flatMap((locale) => messages[locale].prompts);

/** A question compared as quotes are (S-11), with punctuation dropped. */
function questionKey(question: string): string {
  return normalise(question)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The passages a source names; a well-formed source names exactly one. */
function passagesOf({ file, heading }: QuestionSource) {
  return chunks.filter((chunk) => chunk.file === file && chunk.heading === heading);
}

/** The keys that appear more than once in a list of questions. */
function repeated(questions: readonly string[]): string[] {
  const keys = questions.map(questionKey);
  return keys.filter((key, i) => keys.indexOf(key) !== i);
}

// The calibration set of spec §8 (R-18, S-06), written before any score was seen.
describe(CALIBRATION_PATH, () => {
  const groups = LOCALES.flatMap((language) => [
    { language, answerable: true, kind: "answerable" },
    { language, answerable: false, kind: "out-of-scope" },
  ]);

  it.each(groups)("has at least 15 $kind $language questions (S-06)", (group) => {
    const questions = calibration.questions.filter(
      (q) => q.language === group.language && q.answerable === group.answerable,
    );
    expect(questions.length).toBeGreaterThanOrEqual(15);
  });

  it("names each question by its language, kind and number, once", () => {
    const ids = calibration.questions.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of calibration.questions) {
      const language = { en: "en", "pt-BR": "pt" }[q.language];
      expect(q.id).toMatch(new RegExp(`^${language}-${q.answerable ? "in" : "out"}-\\d{2}$`));
    }
  });

  it("pairs each Portuguese question with the English one it translates", () => {
    // The same number, kind and source or terms; only the wording differs.
    const pair = (q: CalibrationQuestion) => ({
      number: q.id.replace(/^(en|pt)-/, ""),
      ...(q.answerable
        ? { file: q.file, heading: q.heading, evidence: q.evidence }
        : { notInCorpus: q.notInCorpus }),
    });
    const english = calibration.questions.filter((q) => q.language === "en");
    const portuguese = calibration.questions.filter((q) => q.language === "pt-BR");
    expect(portuguese.map(pair)).toEqual(english.map(pair));
  });

  it.each(answerable.map((q) => [q.id, q] as const))(
    "cites a passage whose text holds the evidence for %s",
    (_, source) => {
      const passages = passagesOf(source);
      expect(passages).toHaveLength(1);
      expect(verifyQuote(source.evidence, passages[0].text).status).toBe("verified");
    },
  );

  it.each(outOfScope.map((q) => [q.id, q.notInCorpus] as const))(
    "names terms of %s that no corpus file contains",
    (_, terms) => {
      expect(terms.length).toBeGreaterThan(0);
      for (const term of terms) {
        expect(term).toBe(term.toLowerCase());
        expect(corpusText.filter((text) => text.includes(term))).toEqual([]);
      }
    },
  );

  it("repeats no question and no suggested prompt, compared normalised", () => {
    const questions = calibration.questions.map(({ question }) => question);
    expect(repeated([...questions, ...prompts])).toEqual([]);
  });
});

// The measurement set of spec §11, frozen before the first run (S-10, S-13, S-19).
describe(MEASUREMENT_SET_PATH, () => {
  const inScopeQuestions = measurement.questions.filter((q) => q.inScope);
  const outOfScopeQuestions = measurement.questions.filter((q) => !q.inScope);

  it("holds about 40 questions the docs answer and 5 they do not, in three runs of at most 15 (S-10, S-19)", () => {
    expect(inScopeQuestions.length).toBeGreaterThanOrEqual(35);
    expect(outOfScopeQuestions).toHaveLength(5);
    expect(measurement.questions.length).toBeLessThanOrEqual(3 * 15);
  });

  it("numbers each question once", () => {
    const ids = measurement.questions.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^m\d{2}$/);
  });

  it.each(inScopeQuestions.map((q) => [q.id, q] as const))(
    "cites a passage whose text holds the evidence for %s",
    (_, source) => {
      const passages = passagesOf(source);
      expect(passages).toHaveLength(1);
      expect(verifyQuote(source.evidence, passages[0].text).status).toBe("verified");
    },
  );

  it.each(outOfScopeQuestions.map((q) => [q.id, q.notInCorpus] as const))(
    "names terms of %s that no corpus file contains",
    (_, terms) => {
      expect(terms.length).toBeGreaterThan(0);
      for (const term of terms) {
        expect(term).toBe(term.toLowerCase());
        expect(corpusText.filter((text) => text.includes(term))).toEqual([]);
      }
    },
  );

  it("overlaps neither the calibration set nor the suggested prompts, compared normalised", () => {
    // R-20: the calibration set never overlaps the measurement set.
    const others = [...calibration.questions.map(({ question }) => question), ...prompts];
    const taken = new Set(others.map(questionKey));
    const overlapping = measurement.questions.filter((q) => taken.has(questionKey(q.question)));
    expect(overlapping.map(({ id }) => id)).toEqual([]);
    expect(repeated(measurement.questions.map(({ question }) => question))).toEqual([]);
  });
});
