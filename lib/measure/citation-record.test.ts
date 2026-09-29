import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import type { RagMetadata, Source } from "@/lib/rag/message";
import { REFUSAL_SENTENCES } from "@/lib/rag/refusal";
import {
  type AnswerOutcome,
  httpAbortReason,
  type PageReading,
  recordAnswer,
  type StreamReply,
} from "./citation-record";

const QUESTION = { id: "m07", question: "How do I embed many values at once?", inScope: true };
const ASKED_AT = "2026-10-05T14:03:59.123Z";

function source(number: number, text: string): Source {
  return {
    number,
    file: "30-embeddings.mdx",
    heading: "Embeddings › Embedding Many Values",
    startLine: 10 * number,
    endLine: 10 * number + 5,
    text,
    url: `https://github.com/vercel/ai/blob/c/x.mdx?plain=1#L${10 * number}-L${10 * number + 5}`,
    score: 0.6 - number / 100,
  };
}

const SOURCES = [
  source(1, "The AI SDK provides the `embedMany` function for this purpose."),
  source(2, "You can use the `maxParallelCalls` parameter to limit parallel requests."),
];
const RETRIEVAL = { topScore: 0.59, threshold: 0.3, searchMs: 0.31 };
const USAGE = { inputTokens: 2300, outputTokens: 120, totalTokens: 2420 };

/** A finished answer's stream, as the route writes it: its text arrives word by word. */
function answerStream(text: string, finish: Partial<RagMetadata> = { usage: USAGE }): StreamReply {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "a1" },
    { type: "message-metadata", messageMetadata: RETRIEVAL },
    { type: "data-sources", data: SOURCES },
    { type: "start-step" },
    { type: "text-start", id: "t" },
    ...(text.match(/\S+\s*/g) ?? []).map((delta): UIMessageChunk => ({
      type: "text-delta",
      id: "t",
      delta,
    })),
    { type: "text-end", id: "t" },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop", messageMetadata: { ...RETRIEVAL, ...finish } },
  ];
  return { chunks, done: true };
}

/** The gate's refusal stream (spec §5 step 6). */
function gateStream(): StreamReply {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "a1" },
    { type: "message-metadata", messageMetadata: { refusal: "gate", ...RETRIEVAL } },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: REFUSAL_SENTENCES.en },
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: "stop" },
  ];
  return { chunks, done: true };
}

function page(verified: string[], refusal: string | null = null): PageReading {
  return { answers: 1, refusal, verified };
}

function record(
  reply: StreamReply,
  reading: PageReading,
  question = QUESTION,
): Promise<AnswerOutcome> {
  return recordAnswer({ question, askedAt: ASKED_AT, reply, page: reading });
}

const CITED =
  'Call `embedMany` [1: "provides the `embedMany` function"], and cap it ' +
  '[2: "use the `maxParallelCalls` parameter to limit"].';

describe("recordAnswer", () => {
  it("records an answer with citations: text, statuses, metadata, usage and sources", async () => {
    const outcome = await record(answerStream(CITED), page(["true", "true"]));

    expect(outcome).toEqual({
      answer: {
        id: "m07",
        question: QUESTION.question,
        inScope: true,
        askedAt: ASKED_AT,
        classification: "answered-with-citations",
        answer: CITED,
        citations: [
          {
            type: "citation",
            n: 1,
            quote: "provides the `embedMany` function",
            status: "verified",
          },
          {
            type: "citation",
            n: 2,
            quote: "use the `maxParallelCalls` parameter to limit",
            status: "verified",
          },
        ],
        finishReason: "stop",
        ...RETRIEVAL,
        usage: USAGE,
        // The passages without their text, which corpus/index.json holds.
        sources: SOURCES.map((passage) =>
          Object.fromEntries(Object.entries(passage).filter(([key]) => key !== "text")),
        ),
      },
    });
  });

  it("records each attempt that did not verify with its status, in order (S-12)", async () => {
    const text =
      'One [1: "provides the `embedMany` function"]. Two [2: "a sentence the passage lacks"]. ' +
      'Three [6: "a source that was never sent"]. Four [2]. Five [1: "the unfinished';

    const outcome = await record(
      answerStream(text),
      page(["true", "false", "false", "false", "false"]),
    );

    expect("answer" in outcome && outcome.answer.citations).toEqual([
      { type: "citation", n: 1, quote: "provides the `embedMany` function", status: "verified" },
      { type: "citation", n: 2, quote: "a sentence the passage lacks", status: "not-found" },
      { type: "citation", n: 6, quote: "a source that was never sent", status: "unknown-source" },
      { type: "malformed", raw: "[2]", status: "malformed" },
      // An unfinished marker at the end of a finished answer is malformed (spec §6.2).
      { type: "malformed", raw: '[1: "the unfinished', status: "malformed" },
    ]);
  });

  it("classifies an answer with no citation attempt as answered without citations", async () => {
    const outcome = await record(answerStream("Use `embedMany`."), page([]));

    expect(outcome).toMatchObject({
      answer: { classification: "answered-without-citations", citations: [] },
    });
  });

  it("classifies the gate's refusal, which has no usage and no sources", async () => {
    const outcome = await record(gateStream(), page([], "gate"));

    expect(outcome).toMatchObject({
      answer: {
        classification: "gate-refusal",
        answer: REFUSAL_SENTENCES.en,
        citations: [],
        finishReason: "stop",
        ...RETRIEVAL,
        usage: null,
        sources: [],
      },
    });
  });

  it("records whether the question is in scope, for refusal accuracy (S-10)", async () => {
    const outOfScope = {
      id: "m41",
      question: "How do I split PDFs with LlamaIndex?",
      inScope: false,
    };

    const outcome = await record(gateStream(), page([], "gate"), outOfScope);

    expect(outcome).toMatchObject({
      answer: { id: "m41", inScope: false, classification: "gate-refusal" },
    });
  });

  it("classifies a finished answer that is exactly a refusal sentence as the model's", async () => {
    const outcome = await record(answerStream(REFUSAL_SENTENCES["pt-BR"]), page([], "model"));

    expect(outcome).toMatchObject({ answer: { classification: "model-refusal", citations: [] } });
  });

  it("records a count the provider did not report as null", async () => {
    const outcome = await record(
      answerStream(CITED, { usage: { outputTokens: 120 } }),
      page(["true", "true"]),
    );

    expect(outcome).toMatchObject({
      answer: { usage: { inputTokens: null, outputTokens: 120, totalTokens: null } },
    });
  });

  it.each([
    [
      "a reply cut before [DONE]",
      { ...answerStream(CITED), done: false },
      "the reply to m07 ended before [DONE]",
    ],
    [
      "an error chunk",
      {
        chunks: [
          ...answerStream(CITED).chunks.slice(0, -1),
          { type: "error", errorText: "The model could not finish this response." },
        ],
        done: true,
      },
      "the answer to m07 failed: The model could not finish this response.",
    ],
    [
      "an abort chunk",
      { chunks: [...answerStream(CITED).chunks.slice(0, 3), { type: "abort" }], done: true },
      "the answer to m07 was aborted",
    ],
    [
      "no finish chunk",
      { chunks: answerStream(CITED).chunks.slice(0, -1), done: true },
      "the reply to m07 has no finish chunk",
    ],
  ] as const)("aborts the run on %s", async (_, reply, abortReason) => {
    expect(await record(reply as StreamReply, page(["true", "true"]))).toEqual({ abortReason });
  });

  it("aborts the run when the reply carries no search metadata", async () => {
    const { chunks } = answerStream(CITED);
    const reply = {
      chunks: [
        ...chunks.filter((chunk) => chunk.type !== "message-metadata" && chunk.type !== "finish"),
        { type: "finish", finishReason: "stop" } as const,
      ],
      done: true,
    };

    expect(await record(reply, page(["true", "true"]))).toEqual({
      abortReason: "the reply to m07 carries no search metadata",
    });
  });

  it("aborts the run when the page does not show exactly one answer", async () => {
    expect(await record(answerStream(CITED), { answers: 0, refusal: null, verified: [] })).toEqual({
      abortReason: "the page shows 0 answers to m07",
    });
  });

  it("aborts the run when the page and the check disagree (R-14)", async () => {
    expect(await record(answerStream(CITED), page(["true", "false"]))).toEqual({
      abortReason:
        "the page and the check disagree on m07: data-citation-verified true,false on the " +
        "page, true,true in the check",
    });
    expect(await record(gateStream(), page([], null))).toEqual({
      abortReason:
        "the page and the check disagree on m07: data-refusal none on the page, gate " +
        "in the check",
    });
  });
});

describe("httpAbortReason", () => {
  it("names the status and the question, and the rate limit for a 429 (spec §11)", () => {
    expect(httpAbortReason("m05", 429)).toBe("HTTP 429 on m05: the hourly rate limit");
    expect(httpAbortReason("m05", 500)).toBe("HTTP 500 on m05");
  });
});
