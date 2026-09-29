/**
 * Joins the runs of the citation measurement into measurements/citations-YYYY-MM-DD.json and
 * prints the README lines (spec §11, template §7.5, U-P4). By hand, after the last run:
 *   pnpm aggregate-citations
 *
 * It needs one good file per run of measurements/questions.json, all of this version of the
 * set. It never overwrites a different aggregate; run again, it prints the same lines.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { saveMeasurement } from "@/e2e/helpers/measure";
import {
  aggregateRuns,
  CITATIONS_METRIC,
  MEASUREMENT_SET_PATH,
  readMeasurementSet,
  readRunFiles,
} from "@/lib/measure/citation-runs";
import { readmeLines } from "@/lib/measure/citation-stats";
import { measurementPath } from "@/lib/measure/record";
import { readIndexFile } from "@/lib/rag/index-file";

async function main(): Promise<void> {
  const root = process.cwd();
  const { set, sha256 } = readMeasurementSet(root);
  const measurement = aggregateRuns(readRunFiles(root), {
    path: MEASUREMENT_SET_PATH,
    sha256,
    ids: set.questions.map(({ id }) => id),
  });

  const relativePath = measurementPath(CITATIONS_METRIC, measurement);
  const file = path.join(root, relativePath);
  const written = existsSync(file);
  if (!written) {
    await saveMeasurement(root, CITATIONS_METRIC, measurement);
  } else if (readFileSync(file, "utf8") !== `${JSON.stringify(measurement, null, 2)}\n`) {
    throw new Error(`${relativePath} already exists with other data. Rename or delete it first.`);
  }

  const lines = readmeLines(measurement, {
    rawData: relativePath,
    passages: readIndexFile().chunks.length,
  });
  console.log(`${written ? "Already written" : "Wrote"}: ${relativePath}

README line 1:
${lines.title}

First line of "How it's measured":
${lines.howMeasured}

"Decisions" line:
${lines.decision}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
