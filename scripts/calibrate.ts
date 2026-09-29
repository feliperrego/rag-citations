/**
 * Calibrates the gate's threshold on the real index (spec §8, R-18, S-06, S-28). By hand in
 * step 3, with Felipe's OK, after the real `pnpm build-index`: pnpm calibrate
 *
 * It embeds every question of calibration/questions.json and the suggested prompts with the
 * index's own model, in one embedMany call through the Gateway (about US$ 0). It scores each one
 * as the gate does, applies the rule, and prints the report. It refuses to run in mock mode, and
 * exits with code 1 when a suggested prompt lands on the wrong side of the threshold (S-28).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { embedMany } from "ai";
import { LOCALES } from "@/lib/i18n/locale";
import { messages, OUT_OF_SCOPE_PROMPT } from "@/lib/i18n/messages";
import { measurementDay } from "@/lib/measure/record";
import {
  assertRealMode,
  CALIBRATION_PATH,
  type CalibrationSet,
  calibrate,
  checkPrompts,
  formatReport,
} from "@/lib/rag/calibrate";
import { REFUSAL_THRESHOLD } from "@/lib/rag/config";
import { checkQueryDimensions, loadVectors, readIndexFile } from "@/lib/rag/index-file";
import { createInMemoryVectorStore } from "@/lib/rag/vector-store";

// Loaded the way Next.js loads it: variables already set in the shell win.
const ENV_FILE = ".env.local";

async function main(): Promise<void> {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  assertRealMode(process.env);
  const { model, dimensions, entries } = loadVectors(readIndexFile());

  const file = readFileSync(CALIBRATION_PATH);
  const { questions } = JSON.parse(file.toString("utf8")) as CalibrationSet;
  const prompts = LOCALES.flatMap((language) =>
    messages[language].prompts.map((prompt, i) => ({
      language,
      prompt,
      inScope: i !== OUT_OF_SCOPE_PROMPT,
    })),
  );

  const { embeddings, usage } = await embedMany({
    model,
    values: [...questions.map(({ question }) => question), ...prompts.map(({ prompt }) => prompt)],
  });
  // The gate's topScore, as the route computes it: the best cosine over the whole index.
  const store = createInMemoryVectorStore(entries);
  const scores = await Promise.all(
    embeddings.map(async (embedding) => {
      checkQueryDimensions(embedding, dimensions);
      const [best] = await store.search(embedding, 1);
      return best.score;
    }),
  );

  const scored = questions.map(({ id, language, answerable, question }, i) => ({
    id,
    language,
    answerable,
    question,
    score: scores[i],
  }));
  const calibration = calibrate(scored);
  // Once frozen, the prompts are checked against the frozen value, which never moves (S-28).
  const checks = checkPrompts(
    prompts.map((prompt, i) => ({ ...prompt, score: scores[questions.length + i] })),
    REFUSAL_THRESHOLD ?? calibration.threshold,
  );

  process.stdout.write(
    formatReport({
      model,
      dimensions,
      fileHash: createHash("sha256").update(file).digest("hex"),
      date: measurementDay(new Date().toISOString()),
      tokens: usage.tokens,
      questions: scored,
      calibration,
      frozen: REFUSAL_THRESHOLD,
      prompts: checks,
    }),
  );
  if (checks.some(({ ok }) => !ok)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
