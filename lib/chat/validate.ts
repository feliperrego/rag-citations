import { safeValidateUIMessages } from "ai";
import { MAX_USER_CHARS } from "./config";

export type ValidateResult =
  { ok: true; question: string } | { ok: false; status: 400; text: string };

/** Plain-text bodies of the 400 responses. Honest clients never see them. */
export const VALIDATION_ERRORS = {
  json: "Invalid request: the body must be JSON.",
  shape: "Invalid request: expected a JSON body with the latest user message as `message`.",
  role: "Invalid request: the message must be a user message.",
  userPart: "Invalid request: user messages may contain text parts only.",
  userTooLong: `Invalid request: a user message may have at most ${MAX_USER_CHARS} characters.`,
  empty: "Invalid request: the question is empty.",
} as const;

function reject(text: string): ValidateResult {
  return { ok: false, status: 400, text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the question from the body the client posts (spec §5 step 3, S-17). The client sends
 * only the latest user message, as `message`, and its text is the query; any other shape is
 * rejected, including the default transport's `messages` history. Other fields, such as the
 * chat id and `locale`, are ignored here. Pure; async only because safeValidateUIMessages is.
 */
export async function validateQuestion(body: unknown): Promise<ValidateResult> {
  const parsed = await safeValidateUIMessages({
    messages: isRecord(body) ? [body.message] : undefined,
  });
  if (!parsed.success) return reject(VALIDATION_ERRORS.shape);
  const [message] = parsed.data;

  if (message.role !== "user") return reject(VALIDATION_ERRORS.role);
  if (message.parts.some((part) => part.type !== "text")) return reject(VALIDATION_ERRORS.userPart);

  // The text exactly as sent: it is embedded and shown to the model unchanged.
  const question = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  if (question.length > MAX_USER_CHARS) return reject(VALIDATION_ERRORS.userTooLong);
  if (question.trim() === "") return reject(VALIDATION_ERRORS.empty);

  return { ok: true, question };
}
