import { readUIMessageStream, type UIMessageChunk } from "ai";
import { messageText } from "@/lib/chat/ui";
import { createAnswerChecker } from "@/lib/rag/answer";
import {
  type AnswerUsage,
  messageSources,
  type RagUIMessage,
  type Source,
} from "@/lib/rag/message";
import { refusalOf } from "@/lib/rag/refusal";
import type { AnswerRecord, Classification, SourceRef, TokenUsage } from "./citation-stats";

/**
 * One measurement question's record, from the route's reply and the page that showed it
 * (spec §11). The page's data-citation-verified values are the ones counted (R-14); the reply
 * gives the text, the passages and the metadata, and the same checker the page runs must agree
 * with the page, or the run aborts.
 */

/** A 200 reply's UI message stream: its chunks, and whether it ended with [DONE]. */
export type StreamReply = { chunks: readonly UIMessageChunk[]; done: boolean };

/** What the page showed once the answer finished. */
export type PageReading = {
  /** The number of assistant messages on the page. */
  answers: number;
  /** The answer's data-refusal, or null. */
  refusal: string | null;
  /** Each data-citation-verified, in order (spec §6.3). */
  verified: string[];
};

/** Either the question's record, or why the run must stop (spec §11, S-19). */
export type AnswerOutcome = { answer: AnswerRecord } | { abortReason: string };

/** Why a reply other than 200 stops the run; a 429 is the hourly rate limit. */
export function httpAbortReason(id: string, status: number): string {
  return status === 429 ? `HTTP 429 on ${id}: the hourly rate limit` : `HTTP ${status} on ${id}`;
}

/** The finished message, reduced from the chunks by the SDK's own reader, as the page reads it. */
async function finishedMessage(chunks: readonly UIMessageChunk[]): Promise<RagUIMessage | null> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let message: RagUIMessage | null = null;
  for await (const snapshot of readUIMessageStream<RagUIMessage>({ stream })) message = snapshot;
  return message;
}

/** A passage without its text, which corpus/index.json holds. */
function sourceRef({ number, file, heading, startLine, endLine, url, score }: Source): SourceRef {
  return { number, file, heading, startLine, endLine, url, score };
}

function tokenUsage(usage: AnswerUsage | undefined): TokenUsage | null {
  if (usage === undefined) return null;
  const { inputTokens = null, outputTokens = null, totalTokens = null } = usage;
  return { inputTokens, outputTokens, totalTokens };
}

/** Checks a 200 reply and the page against each other, and records the answer. */
export async function recordAnswer({
  question: { id, question, inScope },
  askedAt,
  reply: { chunks, done },
  page,
}: {
  question: { id: string; question: string; inScope: boolean };
  askedAt: string;
  reply: StreamReply;
  page: PageReading;
}): Promise<AnswerOutcome> {
  if (!done) return { abortReason: `the reply to ${id} ended before [DONE]` };
  const failure = chunks.find((chunk) => chunk.type === "error");
  if (failure) return { abortReason: `the answer to ${id} failed: ${failure.errorText}` };
  if (chunks.some((chunk) => chunk.type === "abort")) {
    return { abortReason: `the answer to ${id} was aborted` };
  }
  const finish = chunks.findLast((chunk) => chunk.type === "finish");
  if (!finish) return { abortReason: `the reply to ${id} has no finish chunk` };

  const message = await finishedMessage(chunks);
  const metadata = message?.metadata;
  const numbers = [metadata?.topScore, metadata?.threshold, metadata?.searchMs];
  if (message === null || metadata === undefined || numbers.some((n) => typeof n !== "number")) {
    return { abortReason: `the reply to ${id} carries no search metadata` };
  }
  if (page.answers !== 1) return { abortReason: `the page shows ${page.answers} answers to ${id}` };

  // The page's own functions, on the finished text (spec §6.2, §7).
  const text = messageText(message);
  const sources = messageSources(message);
  const refusal = refusalOf({ metadata, text }, { streaming: false });
  const attempts = createAnswerChecker(sources)(text, { streaming: false }).parts.flatMap((part) =>
    part.type === "attempt" ? [part] : [],
  );
  const verified = attempts.map(({ verification }) => String(verification.status === "verified"));
  const disagree = (what: string, onPage: string, inCheck: string) => ({
    abortReason:
      `the page and the check disagree on ${id}: ` +
      `${what} ${onPage} on the page, ${inCheck} in the check`,
  });
  if (page.refusal !== refusal) {
    return disagree("data-refusal", page.refusal ?? "none", refusal ?? "none");
  }
  if (page.verified.join() !== verified.join()) {
    return disagree("data-citation-verified", page.verified.join(), verified.join());
  }

  const classification: Classification =
    refusal === "gate"
      ? "gate-refusal"
      : refusal === "model"
        ? "model-refusal"
        : attempts.length > 0
          ? "answered-with-citations"
          : "answered-without-citations";
  return {
    answer: {
      id,
      question,
      inScope,
      askedAt,
      classification,
      answer: text,
      citations: attempts.map(({ attempt, verification }) => ({
        ...attempt,
        status: verification.status,
      })),
      finishReason: finish.finishReason ?? null,
      topScore: metadata.topScore,
      threshold: metadata.threshold,
      searchMs: metadata.searchMs,
      usage: tokenUsage(metadata.usage),
      sources: sources.map(sourceRef),
    },
  };
}
