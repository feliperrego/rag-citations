import { expect, test } from "@playwright/test";
import { LOCALES } from "@/lib/i18n/locale";
import { messages, OUT_OF_SCOPE_PROMPT } from "@/lib/i18n/messages";
import { type CitationAttempt, parseAnswer } from "@/lib/rag/citations";
import type { Source } from "@/lib/rag/message";
import { REFUSAL_SENTENCES } from "@/lib/rag/refusal";
import { verifyCitation } from "@/lib/rag/verify";
import { chunkTypes, parseSse, textDeltas } from "@/tests/helpers/sse";

// The chat route in the production mock build (spec §10): the index loads with the route, the
// mock embedder and the pinned mock threshold decide the gate, and the mock model's quotes
// verify against the passages the route sent. The screen's tests come with the chat UI.

/** The body the client posts: only the latest user message (S-17), and the locale. */
function questionBody(text: string, locale: string) {
  return {
    id: "e2e-chat",
    message: { id: "m1", role: "user", parts: [{ type: "text", text }] },
    locale,
  };
}

test("an in-scope question gets its passages, then an answer whose quotes verify", async ({
  request,
}) => {
  const res = await request.post("/api/chat", {
    data: questionBody(messages.en.prompts[0], "en"),
  });

  expect(res.status()).toBe(200);
  const sse = parseSse(await res.text());
  expect(chunkTypes(sse).slice(0, 3)).toEqual(["start", "message-metadata", "data-sources"]);
  expect(sse.chunks.at(-1)).toEqual({ type: "finish", finishReason: "stop" });

  const passages = (sse.chunks[2].data as Source[]).map(({ text }) => text);
  expect(passages).toHaveLength(5);
  const attempts = parseAnswer(textDeltas(sse).join(""), { streaming: false }).filter(
    (segment): segment is CitationAttempt =>
      segment.type === "citation" || segment.type === "malformed",
  );
  expect(attempts.length).toBeGreaterThan(0);
  for (const attempt of attempts) {
    expect(verifyCitation(attempt, passages).status).toBe("verified");
  }
});

for (const locale of LOCALES) {
  test(`the ${locale} out-of-scope question is refused by the gate, with no passages`, async ({
    request,
  }) => {
    const res = await request.post("/api/chat", {
      data: questionBody(messages[locale].prompts[OUT_OF_SCOPE_PROMPT], locale),
    });

    expect(res.status()).toBe(200);
    const raw = await res.text();
    const sse = parseSse(raw);
    expect(sse.chunks[1]).toMatchObject({
      type: "message-metadata",
      messageMetadata: { refusal: "gate" },
    });
    expect(textDeltas(sse)).toEqual([REFUSAL_SENTENCES[locale]]);
    expect(raw).not.toContain("data-sources");
  });
}
