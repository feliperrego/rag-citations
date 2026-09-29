import { test } from "@playwright/test";
import {
  assertRunNotMeasured,
  MEASUREMENT_SET_PATH,
  parseRun,
  quotaFreeAt,
  readMeasurementSet,
  readRunFiles,
  runCount,
  runMetric,
  runQuestions,
} from "@/lib/measure/citation-runs";
import type { AnswerRecord, CitationRun } from "@/lib/measure/citation-stats";
import { askQuestion } from "./helpers/citation-answer";
import { repoRoot, saveMeasurement, startMeasurement } from "./helpers/measure";

// The share of citations verified verbatim on the deployed demo (spec §11). Runs only in the
// `measure` project, one run of at most 15 questions per rate-limit hour, apart from manual
// testing (S-19):
//   MEASURE_URL=<production URL> MEASURE_LOCATION='<city, connection>' MEASURE_RUN=<1..3> \
//     pnpm exec playwright test --project=measure
// Each run writes measurements/citations-run-<r>-YYYY-MM-DD.json (U-P4). After the last one,
// `pnpm aggregate-citations` writes the aggregate and prints the README lines.

/** Longest wait for one answer: the route's 60 s maxDuration, plus margin. */
const ANSWER_TIMEOUT_MS = 90_000;

test("citation rate on the deployed demo", async ({ browser, baseURL }, testInfo) => {
  const root = repoRoot(testInfo);
  const { set, sha256 } = readMeasurementSet(root);
  const runs = runCount(set.questions.length);
  const run = parseRun(process.env.MEASURE_RUN, runs);
  const questions = runQuestions(set.questions, run);
  test.setTimeout(questions.length * 2 * ANSWER_TIMEOUT_MS);

  // Before any request: this run has no good file yet, and the earlier runs' requests have left
  // the rate limiter's window.
  const earlier = readRunFiles(root);
  assertRunNotMeasured(earlier, run);
  const freeAt = quotaFreeAt(earlier);
  if (freeAt !== null && Date.now() < Date.parse(freeAt)) {
    throw new Error(`Wait until ${freeAt}: the rate limit still counts the earlier runs.`);
  }
  const metric = runMetric(run);
  const meta = await startMeasurement({ metric, browser, baseURL, root });

  const answers: AnswerRecord[] = [];
  let abortReason: string | null = null;
  let lastRequestAt: string | null = null;
  for (const question of questions) {
    try {
      const result = await askQuestion(browser, question, meta, { timeout: ANSWER_TIMEOUT_MS });
      lastRequestAt = result.askedAt ?? lastRequestAt;
      if ("abortReason" in result.outcome) {
        abortReason = result.outcome.abortReason;
        break;
      }
      answers.push(result.outcome.answer);
    } catch (error) {
      // The question may have been sent, so the quota guard counts it.
      lastRequestAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      // The first line: Playwright appends a colored call log.
      abortReason = `${question.id} failed: ${message.split("\n")[0]}`;
      break;
    }
  }

  const record: CitationRun = {
    ...meta,
    aborted: abortReason !== null,
    abortReason,
    run,
    runs,
    questionSet: { path: MEASUREMENT_SET_PATH, sha256 },
    questionIds: questions.map(({ id }) => id),
    lastRequestAt,
    answers,
  };
  const relativePath = await saveMeasurement(root, metric, record);
  if (abortReason !== null) {
    throw new Error(`Measurement aborted: ${abortReason}. Wrote ${relativePath}; no README lines.`);
  }

  const citations = answers.flatMap((answer) => answer.citations);
  const verified = citations.filter(({ status }) => status === "verified").length;
  const files = readRunFiles(root);
  const missing = Array.from({ length: runs }, (_, i) => i + 1).filter(
    (r) => !files.some((file) => file.run === r && !file.aborted),
  );
  console.log(
    `Wrote ${relativePath}: run ${run} of ${runs}, ${answers.length} questions, ` +
      `${verified} of ${citations.length} citations verified.\n` +
      (missing.length > 0
        ? `Next: MEASURE_RUN=${missing[0]}, from ${quotaFreeAt(files)}.`
        : "Every run is in: pnpm aggregate-citations writes the aggregate and the README lines."),
  );
});
