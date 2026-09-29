import type { Locale } from "@/lib/i18n/locale";

// The pinned corpus (spec §3, R-02): the AI SDK Core docs at the SDK version the app runs.
export const CORPUS_REPO = "vercel/ai";
export const CORPUS_VERSION = "7.0.114";
export const CORPUS_TAG = `ai@${CORPUS_VERSION}`;
/** The commit the tag resolves to; the GitHub links and the fetch use it, never the tag. */
export const CORPUS_COMMIT = "3f3a717e2237c56aed9fab22269f07ccfeb0a142";
/** The docs directory inside the upstream repo. */
export const CORPUS_REPO_PATH = "content/docs/03-ai-sdk-core";
/** Where the unmodified files are committed, relative to the repo root (S-26). */
export const CORPUS_DIR = "corpus/ai-sdk-core";

/**
 * The SHA-256 of the full Apache License 2.0 text in corpus/LICENSE-2.0.txt (S-26). It comes from
 * apache.org, where no git blob SHA pins it, so the fetch refuses other bytes before writing
 * anything, and tests/corpus.test.ts checks the committed file.
 */
export const APACHE_LICENSE_SHA256 =
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";

/** A ## section longer than this many whitespace-separated words is split at its ### (S-25). */
export const MAX_SECTION_WORDS = 1500;

/** The index built from the corpus (spec §4.2), shipped with the chat route (spec §4.4). */
export const INDEX_PATH = "corpus/index.json";

/** Passages retrieved per question (spec §4.4, R-04). */
export const K = 5;

/** One threshold, or one per interface language when no single one separates both (§8, R-18). */
export type RefusalThreshold = number | Readonly<Record<Locale, number>>;

/**
 * The gate refuses when the best cosine score is below this (spec §8). No single threshold
 * separated the English and Portuguese questions, so there is one per interface language (rule 3),
 * each the value that misclassifies the fewest of that language's questions (rule 4).
 * Calibrated on 2026-09-29 with calibration/questions.json, sha256 f379fd988d6d2158da4fd011aadc365cab2d4bf2d101505bbbc2111b4f84d6f0.
 */
export const REFUSAL_THRESHOLD: RefusalThreshold | null = { en: 0.44209528758554995, "pt-BR": 0.3426526989034122 };

/**
 * The gate's threshold in mock mode, for the word-hash embedder (spec §8, R-19, S-27).
 * tests/mock-threshold.test.ts pins it against the mock index: the three EN in-scope suggested
 * prompts and every e2e scenario question score at least this; the EN and PT out-of-scope
 * prompts score below it.
 */
export const MOCK_REFUSAL_THRESHOLD = 0.19;
