import { parseAnswer } from "@/lib/rag/citations";
import type { AnswerRecord } from "./citation-stats";

/**
 * The trigger that brings back Markdown or code blocks in answers (spec §2, S-14): more than
 * CODE_ANSWER_TRIGGER of the measured answers carry code-like text outside backticks.
 */
export const CODE_ANSWER_TRIGGER = 4;

/** Whether this many code-like answers fire the trigger: more than CODE_ANSWER_TRIGGER (S-14). */
export function codeTriggerFired(count: number): boolean {
  return count > CODE_ANSWER_TRIGGER;
}

/** Code-like text that a plain-text answer shows as prose (R-10). */
const CODE_LIKE = [
  { sign: "=>", pattern: /=>/ },
  { sign: "{", pattern: /[{}]/ },
  { sign: "import", pattern: /\bimport\b[^\n]*\bfrom\s*["']/ },
];

// A fenced block parses as one long code span, so it is looked for in the whole answer.
const FENCE = /^[ \t]*(```|~~~)/m;

/**
 * The code-like signs of an answer: a code fence anywhere, and =>, braces or an import
 * statement in its text outside code spans and citation markers, whose quotes come from the
 * passages (spec §6.2).
 */
export function codeLikeSigns(answer: string): string[] {
  const prose = parseAnswer(answer, { streaming: false })
    .flatMap((segment) => (segment.type === "text" ? [segment.text] : []))
    .join("\n");
  const signs = CODE_LIKE.filter(({ pattern }) => pattern.test(prose)).map(({ sign }) => sign);
  return FENCE.test(answer) ? ["```", ...signs] : signs;
}

export type CodeAnswer = { id: string; signs: string[] };

/** The answered questions whose answer has code-like text outside backticks, in order. */
export function codeLikeAnswers(answers: readonly AnswerRecord[]): CodeAnswer[] {
  return answers.flatMap(({ id, classification, answer }) => {
    if (!classification.startsWith("answered")) return [];
    const signs = codeLikeSigns(answer);
    return signs.length > 0 ? [{ id, signs }] : [];
  });
}
