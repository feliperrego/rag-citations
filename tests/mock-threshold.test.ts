import { describe, expect, it } from "vitest";
import { MOCK_SCENARIO_TRIGGERS } from "@/lib/ai/mock-scenarios";
import { messages, OUT_OF_SCOPE_PROMPT } from "@/lib/i18n/messages";
import { MOCK_REFUSAL_THRESHOLD } from "@/lib/rag/config";
import { loadIndex, readIndexFile } from "@/lib/rag/index-file";
import { createRetriever } from "@/lib/rag/retrieve";

const EN_IN_SCOPE = messages.en.prompts.filter((_, i) => i !== OUT_OF_SCOPE_PROMPT);
const EN_OUT_OF_SCOPE = messages.en.prompts[OUT_OF_SCOPE_PROMPT];
const PT_OUT_OF_SCOPE = messages["pt-BR"].prompts[OUT_OF_SCOPE_PROMPT];
// e2e/i18n.spec.ts asks this Portuguese prompt under the English interface and needs an answer;
// in mock mode the other Portuguese in-scope prompts may be refused (spec §8).
const PT_PAST_THE_GATE = messages["pt-BR"].prompts[2];

// An e2e scenario question is a trigger appended to an in-scope EN question (spec §10). Every
// pairing is checked, so the e2e tests may append a trigger to any of the three.
const SCENARIO_QUESTIONS = EN_IN_SCOPE.flatMap((question) =>
  MOCK_SCENARIO_TRIGGERS.map((trigger) => `${question} ${trigger}`),
);

// The retriever the chat route builds in mock mode: the mock index from corpus/index.json.
const retriever = createRetriever(loadIndex(readIndexFile(), { mock: true, threshold: null }));

async function topScore(question: string): Promise<number> {
  return (await retriever.retrieve(question)).topScore;
}

// Pins the mock threshold against the mock index (spec §8 mock mode, R-19, S-27).
describe("MOCK_REFUSAL_THRESHOLD", () => {
  it("is the mock-mode retriever's threshold", () => {
    expect(retriever.threshold).toBe(MOCK_REFUSAL_THRESHOLD);
  });

  it.each([...EN_IN_SCOPE, ...SCENARIO_QUESTIONS, PT_PAST_THE_GATE])(
    "lets %j past the gate",
    async (question) => {
      expect(await topScore(question)).toBeGreaterThanOrEqual(MOCK_REFUSAL_THRESHOLD);
    },
  );

  it.each([EN_OUT_OF_SCOPE, PT_OUT_OF_SCOPE])("refuses %j at the gate", async (question) => {
    expect(await topScore(question)).toBeLessThan(MOCK_REFUSAL_THRESHOLD);
  });
});
