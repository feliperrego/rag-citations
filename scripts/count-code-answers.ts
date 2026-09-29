/**
 * Counts the measured answers with code-like text outside backticks, the trigger that brings
 * back Markdown or code blocks in answers (spec §2, S-14):
 *   pnpm count-code-answers [measurements/citations-YYYY-MM-DD.json]
 *
 * Without an argument it reads the latest aggregate that `pnpm aggregate-citations` wrote.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { CitationMeasurement } from "@/lib/measure/citation-stats";
import { CODE_ANSWER_TRIGGER, codeLikeAnswers, codeTriggerFired } from "@/lib/measure/code-answers";

const AGGREGATE = /^citations-\d{4}-\d{2}-\d{2}\.json$/;

function latestAggregate(): string {
  const name = readdirSync("measurements")
    .filter((file) => AGGREGATE.test(file))
    .sort()
    .at(-1);
  if (name === undefined) throw new Error("No aggregate yet: run pnpm aggregate-citations.");
  return `measurements/${name}`;
}

function main(): void {
  const file = process.argv[2] ?? latestAggregate();
  const { answers } = JSON.parse(readFileSync(file, "utf8")) as CitationMeasurement;
  const answered = answers.filter(({ classification }) => classification.startsWith("answered"));
  const found = codeLikeAnswers(answers);

  console.log(
    `${file}: ${found.length} of ${answered.length} answers have code-like text outside ` +
      "backticks.",
  );
  for (const { id, signs } of found) console.log(`  ${id}: ${signs.join(" ")}`);
  console.log(
    codeTriggerFired(found.length)
      ? `More than ${CODE_ANSWER_TRIGGER}: the trigger fired; Markdown or code blocks in ` +
          "answers come back for a decision (spec §2, S-14)."
      : `Not more than ${CODE_ANSWER_TRIGGER}: the trigger did not fire (spec §2, S-14).`,
  );
}

main();
