import { describe, expect, it } from "vitest";
import type { AnswerRecord, Classification } from "./citation-stats";
import {
  CODE_ANSWER_TRIGGER,
  codeLikeAnswers,
  codeLikeSigns,
  codeTriggerFired,
} from "./code-answers";

function answer(id: string, text: string, classification: Classification): AnswerRecord {
  return {
    id,
    question: `Question ${id}?`,
    inScope: true,
    askedAt: "2026-10-05T14:00:00.000Z",
    classification,
    answer: text,
    citations: [],
    finishReason: "stop",
    topScore: 0.5,
    threshold: 0.3,
    searchMs: 0.3,
    usage: null,
    sources: [],
  };
}

describe("codeLikeSigns (S-14)", () => {
  it.each([
    ["an arrow", "Pass a callback such as value => value.length to it.", ["=>"]],
    ["a brace", "Call embed with { model, value } and read the result.", ["{"]],
    ["a closing brace alone", "The options end with a } here.", ["{"]],
    ["an import statement", "Write import { embed } from 'ai' at the top.", ["{", "import"]],
    ["a default import", 'Start with import OpenAI from "openai" and go.', ["import"]],
    ["several signs", "Use import { embed } from 'ai' and x => x.", ["=>", "{", "import"]],
  ])("finds %s outside backticks", (_, text, signs) => {
    expect(codeLikeSigns(text)).toEqual(signs);
  });

  it.each([
    ["inside a code span", "Use `(value) => value.length` or `import { embed } from 'ai'`."],
    ["inside a citation's quote", 'It returns [1: "const { embedding } = await embed({"].'],
    ["in plain prose", "You can import the function from the package and call it."],
    ["with no code at all", "Call `embedMany` to embed several values at once."],
  ])("finds nothing %s", (_, text) => {
    expect(codeLikeSigns(text)).toEqual([]);
  });

  it("counts a code fence, closed or not, even though a closed fence parses as a code span", () => {
    expect(codeLikeSigns("Like this:\n```ts\nconst { a } = b;\n```")).toEqual(["```"]);
    expect(codeLikeSigns("Like this:\n  ~~~\nconst a = b;")).toEqual(["```"]);
  });
});

describe("codeLikeAnswers", () => {
  it("lists the answered questions whose answers look like code, with their signs", () => {
    const answers = [
      answer("m01", "Call `embed` with a value.", "answered-with-citations"),
      answer("m02", "Use x => x here.", "answered-without-citations"),
      answer("m03", "Pass { model } to it.", "answered-with-citations"),
      // A refusal is a fixed sentence, never code.
      answer("m04", "I don't know { x }.", "gate-refusal"),
    ];

    expect(codeLikeAnswers(answers)).toEqual([
      { id: "m02", signs: ["=>"] },
      { id: "m03", signs: ["{"] },
    ]);
  });

  it("fires the trigger at more than 4 answers, not at 4 (spec §2, S-14)", () => {
    expect(CODE_ANSWER_TRIGGER).toBe(4);
    expect(codeTriggerFired(0)).toBe(false);
    expect(codeTriggerFired(4)).toBe(false);
    expect(codeTriggerFired(5)).toBe(true);
  });
});
