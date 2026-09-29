import type { MockLanguageModelV4 } from "ai/test";
import { REFUSAL_SENTENCES } from "@/lib/rag/refusal";

/**
 * Per-request behaviour of the chat mock (spec §10, S-27). Its doStream reads the question and
 * the passages from the prompt, so getModel() never takes arguments (template §5.2). It answers
 * with [n: "quote"] markers copied from the passages, so the real verification path runs.
 */

/** The prompt a V4 model receives in doStream(options).prompt. */
export type MockPrompt = Parameters<MockLanguageModelV4["doStream"]>[0]["prompt"];

export type MockScenarioName =
  "default" | "not-found" | "unknown-source" | "malformed" | "refuse" | "slow" | "error";

/** The scenarios whose whole answer mockAnswer writes. */
export type AnswerScenario = Exclude<MockScenarioName, "slow" | "error">;

export type MockTiming = { initialDelayInMs: number; chunkDelayInMs: number };

// Each token is appended to an in-scope English question, as #1 did with [[slow]] and [[error]],
// so the question still passes the mock gate; tests/mock-threshold.test.ts checks that it does.

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

// After [[error]], the first of these tokens that the question holds picks the scenario.
const TRIGGERED_SCENARIOS: readonly (readonly [string, MockScenarioName])[] = [
  [NOT_FOUND_TRIGGER, "not-found"],
  [UNKNOWN_SOURCE_TRIGGER, "unknown-source"],
  [MALFORMED_TRIGGER, "malformed"],
  [REFUSE_TRIGGER, "refuse"],
  [SLOW_TRIGGER, "slow"],
];

/** The template mock's timing (template §5.2), for every scenario. */
export const MOCK_SCENARIO_TIMING: MockTiming = { initialDelayInMs: 600, chunkDelayInMs: 30 };

/** [[slow]]: 300 short lines after the answer, far taller than an 800 px viewport (~9 s). */
export const SLOW_CHUNKS: readonly string[] = Array.from(
  { length: 300 },
  (_, i) => `Line ${i + 1} of the slow mock answer.\n`,
);

/** [[error]]: the text streamed before the mock fails. */
export const ERROR_CHUNKS: readonly string[] = ["This ", "answer ", "fails "];

/** The raw error the [[error]] scenario emits; the route must never send it to the client. */
export const MOCK_ERROR_MESSAGE = "Mock model failure ([[error]] scenario)";

/** The [[notfound]] quote: a valid length, and in no passage (tested against the corpus). */
export const NOT_FOUND_QUOTE = "this sentence does not appear in the passage";

// Question texts that already produced the [[error]] scenario in this server process. The first
// request with a given text fails; Retry (same text) gets the answer.
const seenErrorPrompts = new Set<string>();

/** Text of the last user message in the prompt, or "" when there is none. */
export function lastUserText(prompt: MockPrompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role === "user") {
      return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    }
  }
  return "";
}

/** The instructions: the prompt's system messages, joined with a blank line. */
export function instructionsText(prompt: MockPrompt): string {
  return prompt
    .flatMap((message) => (message.role === "system" ? [message.content] : []))
    .join("\n\n");
}

/**
 * Picks the scenario for one doStream call from the last user message. [[error]] wins, but only
 * the first time this process sees that exact text; then the first other token in
 * MOCK_SCENARIO_TRIGGERS order wins.
 */
export function selectScenario(prompt: MockPrompt): MockScenarioName {
  const text = lastUserText(prompt);
  if (text.includes(ERROR_TRIGGER) && !seenErrorPrompts.has(text)) {
    seenErrorPrompts.add(text);
    return "error";
  }
  return TRIGGERED_SCENARIOS.find(([trigger]) => text.includes(trigger))?.[1] ?? "default";
}

/** Test helper: forget which [[error]] prompts were already seen. */
export function resetMockScenarios(): void {
  seenErrorPrompts.clear();
}

const QUOTE_WORDS = 12;
const MIN_QUOTE_WORDS = 3;
const FENCE = /^\s*(```|~~~)/;

/**
 * The quote the mock copies from a passage: the first 12 words of its first prose line, a line
 * outside code fences that starts with a letter and has at least 3 words, so the quote reads
 * naturally and has 3 to 25 words (R-11). Without such a line, the passage's first 12 words;
 * null when the passage has fewer than 3, as a heading alone does.
 */
export function mockQuote(passage: string): string | null {
  let inFence = false;
  for (const line of passage.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    const words = line.trim().split(/\s+/);
    if (!inFence && /^[A-Za-z]/.test(line) && words.length >= MIN_QUOTE_WORDS) {
      return words.slice(0, QUOTE_WORDS).join(" ");
    }
  }
  const words = passage.trim().split(/\s+/);
  return words.length >= MIN_QUOTE_WORDS ? words.slice(0, QUOTE_WORDS).join(" ") : null;
}

function cite(n: number, quote: string): string {
  return `[${n}: "${quote}"]`;
}

/**
 * The mock's answer to a question with these passages (spec §10). The default cites the first
 * two passages it can quote, with quotes copied from them; [[notfound]], [[unknown]] and
 * [[malformed]] add one citation of their kind after those; [[refuse]] is the refusal sentence
 * alone. The refusal is English because the scenario questions are English (spec §10), and the
 * model refuses in the question's language (S-09).
 */
export function mockAnswer(scenario: AnswerScenario, passages: readonly string[]): string {
  if (scenario === "refuse") return REFUSAL_SENTENCES.en;

  const [first, second] = passages
    .flatMap((passage, i) => {
      const quote = mockQuote(passage);
      return quote === null ? [] : [{ n: i + 1, quote }];
    })
    .slice(0, 2);
  const sentences = [
    "This answer comes from the mock model, which copies each quote from the passages it received.",
  ];
  if (first) sentences.push(`One passage says ${cite(first.n, first.quote)}.`);
  if (second) sentences.push(`Another adds ${cite(second.n, second.quote)}.`);
  sentences.push("API names such as `streamText` are shown as code.");

  if (scenario === "not-found") {
    sentences.push(`It never says ${cite(first?.n ?? 1, NOT_FOUND_QUOTE)}.`);
  } else if (scenario === "unknown-source") {
    const unknown = passages.length + 1;
    sentences.push(`It also cites ${cite(unknown, "a passage the mock never received")}.`);
  } else if (scenario === "malformed") {
    sentences.push("This citation is not in the expected format [2].");
  }
  return sentences.join(" ");
}
