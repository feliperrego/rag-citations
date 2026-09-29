import { isLocale, type Locale } from "@/lib/i18n/locale";
import { CORPUS_VERSION } from "./config";
import { REFUSAL_SENTENCES } from "./refusal";

/**
 * The system instructions, verbatim from spec §6.1 (S-01, R-12), line breaks included. The
 * version and the two refusal sentences are read from their one source, so they cannot drift
 * apart (spec §6.1).
 */
export const SYSTEM_INSTRUCTIONS = [
  "You answer questions about the Vercel AI SDK using only the numbered passages below,",
  `taken from the AI SDK Core documentation at version ${CORPUS_VERSION}.`,
  "1. Use only the passages. If they do not answer the question, reply with exactly this",
  "   sentence and nothing else, in the language of the question:",
  `   English: "${REFUSAL_SENTENCES.en}"`,
  `   Portuguese: "${REFUSAL_SENTENCES["pt-BR"]}"`,
  '2. After each claim, cite its passage as [n: "quote"], where n is the passage number and',
  "   quote is 3 to 25 words copied exactly from that passage. Keep quotes in English, the",
  "   language of the passages, even when you answer in Portuguese.",
  "3. Answer in the language of the user's question. If that is unclear, use the interface",
  "   language stated at the end of these instructions, or English if none is stated.",
  "4. Plain text only: no headings, lists or code blocks. Wrap API names in backticks.",
  "5. Keep answers between 60 and 180 words.",
].join("\n");

/** The last line of the instructions, which rule 3 falls back to (#1 delta spec §3.3). */
const INTERFACE_LANGUAGE: Record<Locale, string> = {
  en: "Interface language: English.",
  "pt-BR": "Interface language: Portuguese (Brazil).",
};

// The passage text goes between the tags unchanged: it is the one passage string that
// data-sources carries and verifyQuote checks (spec §4.1, S-22).
const PASSAGE = /<passage number="(\d+)">\n([\s\S]*?)\n<\/passage>/g;

function formatPassage(text: string, index: number): string {
  return `<passage number="${index + 1}">\n${text}\n</passage>`;
}

/**
 * The instructions for one question (spec §5 step 8): SYSTEM_INSTRUCTIONS, the numbered
 * passages and, for a valid interface language, its line, separated by blank lines. Passage n
 * is passages[n - 1], the numbering data-sources and verifyCitation use.
 */
export function buildInstructions({
  passages,
  locale,
}: {
  passages: readonly string[];
  locale?: Locale;
}): string {
  const blocks = [SYSTEM_INSTRUCTIONS, ...passages.map(formatPassage)];
  // Checked again at runtime, so a value that bypassed the type adds nothing.
  if (isLocale(locale)) blocks.push(INTERFACE_LANGUAGE[locale]);
  return blocks.join("\n\n");
}

/**
 * The passage texts of instructions that buildInstructions built, in order. The chat mock
 * quotes them (spec §10).
 */
export function readPassages(instructions: string): string[] {
  return Array.from(instructions.matchAll(PASSAGE), (match) => match[2]);
}
