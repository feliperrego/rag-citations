import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessageStreamWriter,
} from "ai";
import { getModel, IS_MOCK } from "@/lib/ai/model";
import { CHUNK_TIMEOUT_MS, FIRST_CHUNK_TIMEOUT_MS, MAX_OUTPUT_TOKENS } from "@/lib/chat/config";
import { toSafeErrorMessage } from "@/lib/chat/errors";
import { VALIDATION_ERRORS, validateQuestion } from "@/lib/chat/validate";
import { guardModelRoute } from "@/lib/http";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/locale";
import { REFUSAL_THRESHOLD } from "@/lib/rag/config";
import { loadIndex, readIndexFile } from "@/lib/rag/index-file";
import { answerUsage, type RagUIMessage, toSources } from "@/lib/rag/message";
import { buildInstructions } from "@/lib/rag/prompt";
import { REFUSAL_SENTENCES, thresholdFor } from "@/lib/rag/refusal";
import { createRetriever } from "@/lib/rag/retrieve";

// Node.js runtime (the Next.js default; no `runtime` export). Vercel request cancellation needs
// it and `supportsCancellation` in vercel.json (spec §5 step 8, as #1).
export const maxDuration = 60;

// Built at import, so a real-mode index that breaks a loading rule fails `next build` while it
// collects page data, and no deploy ships it (spec §4.3). Mock mode embeds the chunks at the
// first question (R-19).
const retriever = createRetriever(
  loadIndex(readIndexFile(), { mock: IS_MOCK, threshold: REFUSAL_THRESHOLD }),
);

function badRequest(text: string): Response {
  return new Response(text, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * The interface language a client may send in the body, as in #1 (#1 delta spec §3.3): exactly
 * "en" or "pt-BR". Any other value, or none, is ignored and never causes a 400.
 */
function requestLocale(body: unknown): Locale | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { locale } = body as { locale?: unknown };
  return isLocale(locale) ? locale : undefined;
}

/** Writes a whole text as one text part. */
function writeText(writer: UIMessageStreamWriter<RagUIMessage>, text: string): void {
  const id = "text-1";
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

export async function POST(req: Request): Promise<Response> {
  // 1–2. Rate limit (429), then 415 for a non-JSON body, before the body is read (spec §5).
  const blocked = await guardModelRoute(req);
  if (blocked) return blocked;

  // 3. The latest user message is the whole request, and its text is the query (S-17).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest(VALIDATION_ERRORS.json);
  }
  const validated = await validateQuestion(body);
  if (!validated.ok) return badRequest(validated.text);
  const { question } = validated;
  const locale = requestLocale(body);

  const stream = createUIMessageStream<RagUIMessage>({
    // A failed search, such as a query embedding of the wrong length (spec §4.3), ends the
    // stream with the generic error. Model errors are handled by toUIMessageStream below.
    onError: toSafeErrorMessage,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });

      // 4–5. Embed the question and search the top K passages (spec §4.4).
      const { results, topScore, searchMs } = await retriever.retrieve(question, {
        abortSignal: req.signal,
      });

      // 6. The gate, in the interface language: the route cannot tell the question's language
      // without a model call (spec §8, S-09). No data-sources, and no model call (S-24).
      const language = locale ?? DEFAULT_LOCALE;
      const threshold = thresholdFor(retriever.threshold, language);
      if (topScore < threshold) {
        writer.write({
          type: "message-metadata",
          messageMetadata: { refusal: "gate", topScore, threshold, searchMs },
        });
        writeText(writer, REFUSAL_SENTENCES[language]);
        writer.write({ type: "finish", finishReason: "stop" });
        return;
      }

      // 7. The passages travel as a data part before the answer (spec §5 step 7).
      const retrieval = { topScore, threshold, searchMs };
      writer.write({ type: "message-metadata", messageMetadata: retrieval });
      const sources = toSources(results);
      writer.write({ type: "data-sources", data: sources });

      // 8. The model sees only this question and the passages, no history (R-05, R-06).
      const result = streamText({
        model: getModel(),
        instructions: buildInstructions({ passages: sources.map(({ text }) => text), locale }),
        prompt: question,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        reasoning: "none",
        abortSignal: req.signal,
        timeout: { firstChunkMs: FIRST_CHUNK_TIMEOUT_MS, chunkMs: CHUNK_TIMEOUT_MS },
        // Suppresses streamText's own console.error(error) default: the error is already
        // logged once by toSafeErrorMessage in toUIMessageStream's onError below.
        onError: () => {},
      });
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendStart: false,
          sendReasoning: false,
          onError: toSafeErrorMessage,
          // The answer's token usage rides on its finish chunk, for the measurement (spec §11).
          messageMetadata: ({ part }) =>
            part.type === "finish"
              ? { ...retrieval, usage: answerUsage(part.totalUsage) }
              : undefined,
        }),
      );
    },
  });

  return createUIMessageStreamResponse({ stream });
}
