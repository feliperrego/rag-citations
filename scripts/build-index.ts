/**
 * Builds corpus/index.json from the committed corpus (spec §4.2, S-07).
 *
 * Mock mode, zero cost, what CI, the e2e tests and Preview use: AI_MOCK=1 pnpm build-index
 * Real mode, by hand in step 3 with Felipe's OK: after `vercel env pull` has written the
 * Gateway's OIDC token to .env.local, EMBEDDING_MODEL=<provider/model> pnpm build-index
 */
import { existsSync, writeFileSync } from "node:fs";
import { CORPUS_DIR, INDEX_PATH } from "@/lib/rag/config";
import { readCorpus } from "@/lib/rag/corpus";
import { buildIndex, resolveEmbeddingModel, serializeIndex } from "@/lib/rag/index-file";

// Loaded the way Next.js loads it: variables already set in the shell win.
const ENV_FILE = ".env.local";

async function main(): Promise<void> {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const embeddingModel = resolveEmbeddingModel(process.env);
  const files = readCorpus(CORPUS_DIR);
  const { index, tokens } = await buildIndex({ files, embeddingModel, builtAt: new Date() });

  const json = serializeIndex(index);
  writeFileSync(INDEX_PATH, json);
  const mode =
    embeddingModel === null
      ? "mock: no model call, no vectors"
      : `real: ${index.model}, ${index.dimensions} dimensions, ${tokens} tokens`;
  console.log(`Mode:        ${mode}
Chunks:      ${index.chunks.length} from ${files.length} files
Corpus hash: ${index.corpusHash}
Wrote:       ${INDEX_PATH}, ${Buffer.byteLength(json).toLocaleString("en-US")} bytes`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
