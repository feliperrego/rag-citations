import { expect, type Browser, type Page } from "@playwright/test";
import type { UIMessageChunk } from "ai";
import { messages } from "@/lib/i18n/messages";
import { type AnswerOutcome, httpAbortReason, recordAnswer } from "@/lib/measure/citation-record";
import { type ParsedSse, parseSse } from "@/tests/helpers/sse";
import { captureChatReply } from "./chat-reply";
import type { Deployment } from "./measure";

/** One question asked, and when it was sent: null when the run stopped before sending it. */
export type AskResult = { askedAt: string | null; outcome: AnswerOutcome };

/** The deployment the page's header names: its model and its commit. */
export async function readHeader(page: Page): Promise<Deployment> {
  const header = page.locator("header[data-model]");
  await expect(header).toBeVisible();
  return {
    model: ((await header.getAttribute("data-model")) ?? "").trim(),
    commit: (await header.getAttribute("data-commit")) ?? "",
  };
}

/**
 * Asks one measurement question in a fresh context, in the English interface (S-13): types it,
 * sends it, waits for the answer to finish, then reads the page's data-refusal and every
 * data-citation-verified (spec §11). recordAnswer checks them against the reply. `timeout`
 * limits every step, so a page that stalls fails this question and the run can abort (S-19).
 */
export async function askQuestion(
  browser: Browser,
  question: { id: string; question: string; inScope: boolean },
  expected: Deployment,
  { timeout }: { timeout: number },
): Promise<AskResult> {
  const { composer } = messages.en;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto("/", { timeout });
    const deployed = await readHeader(page);
    if (deployed.model !== expected.model || deployed.commit !== expected.commit) {
      return {
        askedAt: null,
        outcome: { abortReason: `the deployment changed before ${question.id}` },
      };
    }

    const send = page.getByRole("button", { name: composer.send, exact: true });
    await page.getByRole("textbox", { name: composer.label }).fill(question.question, { timeout });
    const askedAt = new Date().toISOString();
    const reply = await captureChatReply(page, () => send.click({ timeout }), { timeout });
    if (reply.status !== 200) {
      return { askedAt, outcome: { abortReason: httpAbortReason(question.id, reply.status) } };
    }
    let sse: ParsedSse;
    try {
      sse = parseSse(reply.body);
    } catch (error) {
      const abortReason = `the reply to ${question.id} is not a UI message stream: ${error}`;
      return { askedAt, outcome: { abortReason } };
    }

    // The page has been busy since the send, so Send is back once it has read the last chunk.
    await expect(send).toBeVisible({ timeout });
    const bubbles = page.locator('[data-message-role="assistant"]');
    const answers = await bubbles.count();
    const bubble = bubbles.last();
    const reading = {
      answers,
      refusal: answers === 0 ? null : await bubble.getAttribute("data-refusal"),
      verified: await bubble
        .locator("[data-citation-verified]")
        .evaluateAll((buttons) =>
          buttons.map((b) => b.getAttribute("data-citation-verified") ?? ""),
        ),
    };
    const outcome = await recordAnswer({
      question,
      askedAt,
      reply: { chunks: sse.chunks as unknown as UIMessageChunk[], done: sse.done },
      page: reading,
    });
    return { askedAt, outcome };
  } finally {
    await context.close();
  }
}
