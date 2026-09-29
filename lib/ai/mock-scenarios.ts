/**
 * Magic tokens that pick the chat mock's scenario (spec §10, S-27). Each is appended to an
 * in-scope English question, as #1 did with [[slow]] and [[error]], so the question still passes
 * the mock gate; tests/mock-threshold.test.ts checks that it does.
 */

/** Quotes a phrase that is not in its passage: the "not found" badge. */
export const NOT_FOUND_TRIGGER = "[[notfound]]";
/** Cites a passage number outside 1–5: "No such source". */
export const UNKNOWN_SOURCE_TRIGGER = "[[unknown]]";
/** Writes a citation that is not a well-formed marker. */
export const MALFORMED_TRIGGER = "[[malformed]]";
/** Answers with the model's refusal sentence. */
export const REFUSE_TRIGGER = "[[refuse]]";
/** A long, slow answer, for Stop and autoscroll. */
export const SLOW_TRIGGER = "[[slow]]";
/** Fails partway through the answer. */
export const ERROR_TRIGGER = "[[error]]";

export const MOCK_SCENARIO_TRIGGERS = [
  NOT_FOUND_TRIGGER,
  UNKNOWN_SOURCE_TRIGGER,
  MALFORMED_TRIGGER,
  REFUSE_TRIGGER,
  SLOW_TRIGGER,
  ERROR_TRIGGER,
] as const;
