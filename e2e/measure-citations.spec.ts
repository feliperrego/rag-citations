import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  ERROR_TRIGGER,
  MALFORMED_TRIGGER,
  NOT_FOUND_TRIGGER,
  REFUSE_TRIGGER,
  UNKNOWN_SOURCE_TRIGGER,
} from "@/lib/ai/mock-scenarios";
import { SAFE_ERROR_MESSAGE } from "@/lib/chat/errors";
import { messages, OUT_OF_SCOPE_PROMPT } from "@/lib/i18n/messages";
import type { AnswerRecord } from "@/lib/measure/citation-stats";
import type { AnswerOutcome } from "@/lib/measure/citation-record";
import { mockWords } from "@/lib/rag/embedder";
import { captureChatReply } from "./helpers/chat-reply";
import { askQuestion, readHeader } from "./helpers/citation-answer";
import type { Deployment } from "./helpers/measure";

// The instrument of the citation measurement (spec §11), against the local mock build: it asks
// one question as e2e/citations.measure.ts does on the live demo, reads the page and the reply,
// and each scenario of the chat mock lands in its classification or status. No test writes a
// measurement file.

const TIMEOUT = { timeout: 30_000 };
// An in-scope question for the scenario triggers (tests/mock-threshold.test.ts pins its score).
const QUESTION = messages.en.prompts[2];

// What the local build's header names, read once rather than typed: its commit is
// VERCEL_GIT_COMMIT_SHA when the build's environment sets one, and "local" otherwise.
let localBuild: Deployment;
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  localBuild = await readHeader(page);
  await page.close();
});

test("the local build's header names the mock model", () => {
  expect(localBuild.model).toBe("mock");
});

function answerOf(outcome: AnswerOutcome): AnswerRecord {
  if ("abortReason" in outcome) throw new Error(`Unexpected abort: ${outcome.abortReason}`);
  return outcome.answer;
}

test("a suggested question is recorded as answered, its citations verified", async ({
  browser,
}) => {
  const before = new Date().toISOString();

  const { askedAt, outcome } = await askQuestion(
    browser,
    { id: "t01", question: QUESTION, inScope: true },
    localBuild,
    TIMEOUT,
  );

  const answer = answerOf(outcome);
  expect(Date.parse(askedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(before));
  expect(answer).toMatchObject({
    id: "t01",
    question: QUESTION,
    inScope: true,
    askedAt,
    classification: "answered-with-citations",
    finishReason: "stop",
    // The mock reports no input tokens and one output token per chunk.
    usage: { inputTokens: 0, outputTokens: expect.any(Number), totalTokens: expect.any(Number) },
  });
  // The mock quotes the first two passages it can quote (spec §10).
  expect(answer.citations.map(({ status }) => status)).toEqual(["verified", "verified"]);
  expect(answer.sources).toHaveLength(5);
  expect(answer.topScore).toBeGreaterThanOrEqual(answer.threshold);
  expect(answer.searchMs).toBeGreaterThanOrEqual(0);
});

for (const [trigger, status] of [
  [NOT_FOUND_TRIGGER, "not-found"],
  [UNKNOWN_SOURCE_TRIGGER, "unknown-source"],
  [MALFORMED_TRIGGER, "malformed"],
] as const) {
  test(`the ${trigger} scenario is recorded with one ${status} citation (S-12)`, async ({
    browser,
  }) => {
    const { outcome } = await askQuestion(
      browser,
      { id: "t02", question: `${QUESTION} ${trigger}`, inScope: true },
      localBuild,
      TIMEOUT,
    );

    const answer = answerOf(outcome);
    expect(answer.classification).toBe("answered-with-citations");
    expect(answer.citations.map((citation) => citation.status)).toEqual([
      "verified",
      "verified",
      status,
    ]);
  });
}

test("the out-of-scope question is recorded as a gate refusal, with no usage", async ({
  browser,
}) => {
  const { outcome } = await askQuestion(
    browser,
    { id: "t03", question: messages.en.prompts[OUT_OF_SCOPE_PROMPT], inScope: false },
    localBuild,
    TIMEOUT,
  );

  expect(answerOf(outcome)).toMatchObject({
    inScope: false,
    classification: "gate-refusal",
    answer: messages.en.refusal,
    citations: [],
    usage: null,
    sources: [],
  });
});

test("the [[refuse]] scenario is recorded as a model refusal", async ({ browser }) => {
  const { outcome } = await askQuestion(
    browser,
    { id: "t04", question: `${QUESTION} ${REFUSE_TRIGGER}`, inScope: true },
    localBuild,
    TIMEOUT,
  );

  expect(answerOf(outcome)).toMatchObject({ classification: "model-refusal", citations: [] });
});

test("a failed answer stops the run", async ({ browser }) => {
  // The mock fails each [[error]] text once per server process, so the question gets a tag of
  // numbers that the mock embedder skips, which keeps its score.
  const tag = Array.from({ length: 6 }, () => String(randomInt(100)).padStart(2, "0")).join("-");
  expect(mockWords(tag)).toEqual([]);

  const { askedAt, outcome } = await askQuestion(
    browser,
    { id: "t05", question: `${QUESTION} ${ERROR_TRIGGER} ${tag}`, inScope: true },
    localBuild,
    TIMEOUT,
  );

  expect(askedAt).not.toBeNull();
  expect(outcome).toEqual({ abortReason: `the answer to t05 failed: ${SAFE_ERROR_MESSAGE}` });
});

test("a changed deployment stops the run before the question is sent", async ({ browser }) => {
  const { askedAt, outcome } = await askQuestion(
    browser,
    { id: "t06", question: QUESTION, inScope: true },
    { ...localBuild, commit: "another-commit" },
    TIMEOUT,
  );

  expect(askedAt).toBeNull();
  expect(outcome).toEqual({ abortReason: "the deployment changed before t06" });
});

// A stall must fail one question within its timeout, so the run's catch writes the .aborted.json
// with lastRequestAt while the process is alive (spec §11, S-19), rather than the whole run's
// test timeout killing it with no file.
test("a question whose Send never enables fails within the timeout", async ({ browser }) => {
  // Whitespace keeps Send disabled, as a page that never enables it would.
  const question = { id: "t07", question: "   ", inScope: true };

  await expect(askQuestion(browser, question, localBuild, { timeout: 1_000 })).rejects.toThrow(
    /Timeout 1000ms exceeded/,
  );
});

test("a send that makes no request fails the capture within its timeout", async ({ page }) => {
  await page.goto("/");

  await expect(captureChatReply(page, async () => {}, { timeout: 500 })).rejects.toThrow(
    "no POST /api/chat within 500 ms",
  );
});
