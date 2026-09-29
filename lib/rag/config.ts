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
