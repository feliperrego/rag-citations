import { describe, expect, it } from "vitest";
import type { RagMetadata } from "./message";
import { isRefusalText, refusalOf, thresholdFor } from "./refusal";

// The refusal sentences, verbatim from spec §7.1 (R-17).
const EN = "I don't know. The AI SDK Core docs I search don't cover that.";
const PT = "Não sei. A documentação do AI SDK Core que eu consulto não cobre isso.";

describe("isRefusalText", () => {
  it.each([
    ["the English sentence", EN],
    ["the Portuguese sentence", PT],
    ["curly apostrophes", EN.replaceAll("'", "’")],
    ["other whitespace and letter case", `\n  ${PT.replace(" A ", "\n a ").toUpperCase()}  \n`],
  ])("accepts %s (spec §7)", (_, answer) => {
    expect(isRefusalText(answer)).toBe(true);
  });

  it.each([
    ["an empty answer", ""],
    ["one sentence of the two", "I don't know."],
    ["the sentence followed by more text", `${EN} Try the reference docs.`],
    ["the sentence with a citation", `${EN} [1: "embed many values"]`],
    ["an answer that mixes both languages", `${EN} ${PT}`],
  ])("rejects %s", (_, answer) => {
    expect(isRefusalText(answer)).toBe(false);
  });
});

// The gate's threshold under each interface language (spec §8 rule 3, R-18).
describe("thresholdFor", () => {
  it("applies one threshold to both languages", () => {
    expect(thresholdFor(0.4, "en")).toBe(0.4);
    expect(thresholdFor(0.4, "pt-BR")).toBe(0.4);
  });

  it("picks the interface language's own threshold when they are keyed by language", () => {
    const threshold = { en: 0.45, "pt-BR": 0.38 };
    expect(thresholdFor(threshold, "en")).toBe(0.45);
    expect(thresholdFor(threshold, "pt-BR")).toBe(0.38);
  });
});

// How a message is marked (spec §7, S-24): data-refusal="gate" or "model".
describe("refusalOf", () => {
  const gate: RagMetadata = { refusal: "gate", topScore: 0.12, threshold: 0.19, searchMs: 0.8 };
  const answered: RagMetadata = { topScore: 0.42, threshold: 0.19, searchMs: 0.8 };

  it("marks the gate's refusal from its metadata, even while it streams", () => {
    expect(refusalOf({ metadata: gate, text: EN }, { streaming: true })).toBe("gate");
    expect(refusalOf({ metadata: gate, text: PT }, { streaming: false })).toBe("gate");
  });

  it.each([
    ["English", EN],
    ["Portuguese", PT],
  ])("marks a finished answer that is exactly the %s sentence as the model's", (_, text) => {
    expect(refusalOf({ metadata: answered, text }, { streaming: false })).toBe("model");
  });

  it("waits until the answer has finished", () => {
    expect(refusalOf({ metadata: answered, text: EN }, { streaming: true })).toBeNull();
  });

  it.each([
    ["an answer", 'Use `embedMany` [1: "embed many values"].'],
    ["the sentence followed by more text", `${EN} Try the reference docs.`],
  ])("leaves %s unmarked", (_, text) => {
    expect(refusalOf({ metadata: answered, text }, { streaming: false })).toBeNull();
    expect(refusalOf({ text }, { streaming: false })).toBeNull();
  });
});
