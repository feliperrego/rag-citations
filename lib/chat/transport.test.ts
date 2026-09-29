import { afterEach, describe, expect, it, vi } from "vitest";
import type { RagUIMessage } from "@/lib/rag/message";
import { chatTransport } from "./transport";
import { validateQuestion } from "./validate";

function user(id: string, text: string): RagUIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

/** Shaped like a streamed answer: its passages, then text. */
function assistant(id: string, text: string): RagUIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "data-sources", data: [] },
      { type: "text", text, state: "done" },
    ],
  };
}

type Posted = { url: string; body: Record<string, unknown> };

/** Sends through chatTransport with fetch stubbed, and returns what it posted. */
async function post(
  messages: RagUIMessage[],
  options: { trigger?: "submit-message" | "regenerate-message"; body?: object } = {},
): Promise<Posted> {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
  );
  vi.stubGlobal("fetch", fetch);
  await chatTransport.sendMessages({
    chatId: "chat-1",
    messages,
    trigger: options.trigger ?? "submit-message",
    messageId: undefined,
    abortSignal: undefined,
    body: options.body,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  return { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The client sends only the latest user message (spec §5 step 3, S-17).
describe("chatTransport", () => {
  it("posts only the latest message, the chat id and the locale to /api/chat", async () => {
    const question = user("u2", "How do I rerank search results?");
    const history = [user("u1", "First question"), assistant("a1", "First answer"), question];

    const { url, body } = await post(history, { body: { locale: "pt-BR" } });

    expect(url).toBe("/api/chat");
    expect(body).toEqual({ locale: "pt-BR", id: "chat-1", message: question });
  });

  it("posts the question again on a Regenerate, which has dropped the old answer", async () => {
    const question = user("u1", "How do I embed many values in parallel?");

    const { body } = await post([question], {
      trigger: "regenerate-message",
      body: { locale: "en" },
    });

    expect(body).toEqual({ locale: "en", id: "chat-1", message: question });
  });

  it("sends no history however long the conversation is, so no cap applies", async () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? user(`u${i}`, `question ${i}`) : assistant(`a${i}`, `answer ${i}`),
    );
    history.push(user("u30", "question 30"));

    const { body } = await post(history);

    expect(body).toEqual({ id: "chat-1", message: user("u30", "question 30") });
  });

  it("builds a body the route accepts, with the question exactly as typed", async () => {
    const text = "  Como testar meu código\nsem chamar um modelo?  ";

    const { body } = await post([user("u1", text)], { body: { locale: "pt-BR" } });

    expect(await validateQuestion(body)).toEqual({ ok: true, question: text });
  });
});
