import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import type { RefusalThreshold } from "./config";
import { normalise } from "./verify";

/**
 * The fixed refusal sentences (R-17), read from the dictionary's `refusal` entries, their one
 * source: the gate writes them, and the system instructions quote them (spec §6.1).
 */
export const REFUSAL_SENTENCES: Readonly<Record<Locale, string>> = {
  en: messages.en.refusal,
  "pt-BR": messages["pt-BR"].refusal,
};

const NORMALISED_REFUSALS = new Set(Object.values(REFUSAL_SENTENCES).map(normalise));

/**
 * A model refusal: a finished answer whose normalised text equals either refusal sentence
 * exactly (spec §7, S-24). The message then gets data-refusal="model".
 */
export function isRefusalText(answer: string): boolean {
  return NORMALISED_REFUSALS.has(normalise(answer));
}

/**
 * The threshold the gate applies under an interface language: the one threshold, or that
 * language's own when the calibration keyed them by language (spec §8 rule 3, R-18).
 */
export function thresholdFor(threshold: RefusalThreshold, locale: Locale): number {
  return typeof threshold === "number" ? threshold : threshold[locale];
}
