import { describe, expect, it } from "vitest";
import { isRefusalText } from "./refusal";

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
