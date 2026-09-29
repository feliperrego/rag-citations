import { describe, expect, it } from "vitest";
import { readIndexFile } from "./index-file";
import { buildInstructions, readPassages, SYSTEM_INSTRUCTIONS } from "./prompt";

// Spec §6.1, copied here as a literal, line breaks and indents included, so any change to the
// instructions fails until the new text is reviewed (S-01). The test never reads the spec. The
// line break after the opening backtick is dropped.
const SPEC_INSTRUCTIONS = `
You answer questions about the Vercel AI SDK using only the numbered passages below,
taken from the AI SDK Core documentation at version 7.0.114.
1. Use only the passages. If they do not answer the question, reply with exactly this
   sentence and nothing else, in the language of the question:
   English: "I don't know. The AI SDK Core docs I search don't cover that."
   Portuguese: "Não sei. A documentação do AI SDK Core que eu consulto não cobre isso."
2. After each claim, cite its passage as [n: "quote"], where n is the passage number and
   quote is 3 to 25 words copied exactly from that passage. Keep quotes in English, the
   language of the passages, even when you answer in Portuguese.
3. Answer in the language of the user's question. If that is unclear, use the interface
   language stated at the end of these instructions, or English if none is stated.
4. Plain text only: no headings, lists or code blocks. Wrap API names in backticks.
5. Keep answers between 60 and 180 words.`.slice(1);

describe("SYSTEM_INSTRUCTIONS", () => {
  it("is spec §6.1 verbatim", () => {
    expect(SYSTEM_INSTRUCTIONS).toBe(SPEC_INSTRUCTIONS);
  });
});

describe("buildInstructions", () => {
  it("numbers the passages from 1, each exactly as its text, after the instructions", () => {
    const instructions = buildInstructions({
      passages: ["\nFirst passage.\n", "## Second\n\nText"],
    });
    expect(instructions).toBe(
      [
        SPEC_INSTRUCTIONS,
        '<passage number="1">\n\nFirst passage.\n\n</passage>',
        '<passage number="2">\n## Second\n\nText\n</passage>',
      ].join("\n\n"),
    );
  });

  it.each([
    ["en", "Interface language: English."],
    ["pt-BR", "Interface language: Portuguese (Brazil)."],
  ] as const)("ends with the interface-language line for %s", (locale, line) => {
    const instructions = buildInstructions({ passages: ["Text"], locale });
    expect(instructions).toBe(`${buildInstructions({ passages: ["Text"] })}\n\n${line}`);
  });

  it("adds no line for a value outside the type, checked again at runtime", () => {
    const locale = "pt-br" as unknown as "pt-BR";
    expect(buildInstructions({ passages: ["Text"], locale })).toBe(
      buildInstructions({ passages: ["Text"] }),
    );
  });
});

describe("readPassages", () => {
  it("returns no passages for text without any", () => {
    expect(readPassages(SPEC_INSTRUCTIONS)).toEqual([]);
  });

  // The chat mock reads the passages back from the instructions it receives (spec §10).
  it("reads back every committed chunk's text exactly, five at a time", () => {
    const texts = readIndexFile().chunks.map((chunk) => chunk.text);
    for (let i = 0; i < texts.length; i += 5) {
      const passages = texts.slice(i, i + 5);
      expect(readPassages(buildInstructions({ passages, locale: "pt-BR" }))).toEqual(passages);
    }
  });
});
