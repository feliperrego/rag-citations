import { DefaultChatTransport } from "ai";
import type { RagUIMessage } from "@/lib/rag/message";

/**
 * The chat's transport to POST /api/chat (spec §5 step 3, S-17). Each request carries only the
 * latest message, which is the question on a send and again on a Regenerate or a Retry (those
 * drop the old answer first), plus the chat id and the request's body, such as the interface
 * language. No history is sent, so #1's 20-message cap does not apply.
 */
export const chatTransport = new DefaultChatTransport<RagUIMessage>({
  prepareSendMessagesRequest: ({ id, messages, body }) => ({
    body: { ...body, id, message: messages.at(-1) },
  }),
});
