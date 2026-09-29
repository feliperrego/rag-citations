import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CITATIONS_METRIC } from "@/lib/measure/citation-runs";
import {
  type CitationMeasurement,
  type ReadmeLines,
  readmeLines,
} from "@/lib/measure/citation-stats";
import { measurementPath } from "@/lib/measure/record";
import { slugify } from "@/lib/rag/chunk";
import { readIndexFile } from "@/lib/rag/index-file";

const readme = readFileSync("README.md", "utf8");
const lines = readme.trimEnd().split("\n");

// What the README shows until `pnpm aggregate-citations` prints the measured lines (spec §11).
const PENDING: ReadmeLines = {
  title:
    "# RAG with Citations — citation verification rate: pending the first production measurement",
  howMeasured:
    "Pending: the first production measurement prints this line: n, the answers by " +
    "classification, the refusal accuracy, the unverified citations by status with their " +
    "answers' ids, the model, the location, the days and a link to the raw data. A verified " +
    "quote is in its passage " +
    "word for word, allowing only whitespace, quote style, Unicode form and letter case; it " +
    "does not prove that the passage supports the claim.",
  decision:
    "- **The index is committed to the repo and searched in memory** instead of a vector " +
    "database: the first production measurement prints its median search time here; a " +
    "database waits for more than ~5,000 vectors or writes at runtime.",
};

const AGGREGATE = /^citations-\d{4}-\d{2}-\d{2}\.json$/;

/** The lines scripts/aggregate-citations.ts prints for the latest aggregate, or PENDING. */
function measuredLines(): ReadmeLines {
  const latest = readdirSync("measurements")
    .filter((file) => AGGREGATE.test(file))
    .sort()
    .at(-1);
  if (latest === undefined) return PENDING;
  const measurement = JSON.parse(
    readFileSync(path.join("measurements", latest), "utf8"),
  ) as CitationMeasurement;
  return readmeLines(measurement, {
    rawData: measurementPath(CITATIONS_METRIC, measurement),
    passages: readIndexFile().chunks.length,
  });
}

/** The lines under a `## ` heading, up to the next one. */
function section(heading: string): string[] {
  const start = lines.indexOf(`## ${heading}`);
  expect(start, `## ${heading}`).toBeGreaterThan(0);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The GitHub anchors of a Markdown file's headings. */
function anchors(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^#{1,6} +(.+)$/gm)].map(([, text]) =>
    slugify(text.trim()),
  );
}

describe("README.md", () => {
  it("fits one screen: 40 lines at most (template §8)", () => {
    expect(lines.length).toBeLessThanOrEqual(40);
  });

  // Line 1, the first line of "How it's measured" and the index decision carry the measured
  // numbers, so they are pasted from the script, never typed (spec §1 criterion 5, §11).
  it("holds the lines of the latest measurement, or the pending ones before the first", () => {
    const expected = measuredLines();
    expect(lines[0]).toBe(expected.title);
    expect(section("How it's measured")[0]).toBe(expected.howMeasured);
    expect(section("Decisions")).toContain(expected.decision);
  });

  it("links only to repo files and headings that exist", () => {
    const targets = [...readme.matchAll(/\]\(([^)]+)\)/g)]
      .map(([, target]) => target)
      .filter((target) => !/^(https?:|<)/.test(target));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const [file, anchor] = target.split("#");
      expect(existsSync(file), target).toBe(true);
      if (anchor !== undefined) expect(anchors(file), target).toContain(anchor);
    }
  });
});
