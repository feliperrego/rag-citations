import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { chunkCorpus, countWords } from "@/lib/rag/chunk";
import {
  APACHE_LICENSE_SHA256,
  CORPUS_COMMIT,
  CORPUS_DIR,
  CORPUS_TAG,
  INDEX_PATH,
  MAX_SECTION_WORDS,
} from "@/lib/rag/config";
import { corpusHash, corpusManifest, readCorpus } from "@/lib/rag/corpus";
import { readIndexFile } from "@/lib/rag/index-file";
import { normalise, verifyQuote } from "@/lib/rag/verify";

const files = readCorpus(CORPUS_DIR);

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("the committed corpus", () => {
  it("is byte for byte what scripts/fetch-corpus.ts wrote (corpus/SHA256SUMS)", () => {
    expect(corpusManifest(files)).toBe(readFileSync("corpus/SHA256SUMS", "utf8"));
  });

  it("is what corpus/SOURCES.md describes", () => {
    const sources = readFileSync("corpus/SOURCES.md", "utf8");
    const bytes = files.reduce((sum, { content }) => sum + Buffer.byteLength(content, "utf8"), 0);
    expect(sources).toContain(`\`${CORPUS_TAG}\``);
    expect(sources).toContain(`\`${CORPUS_COMMIT}\``);
    expect(sources).toContain(
      `${files.length} \`.mdx\` files, ${bytes.toLocaleString("en-US")} bytes`,
    );
    expect(sources).toContain(`\`${corpusHash(files)}\``);
  });

  it("keeps the license files corpus/SOURCES.md records, the Apache text as pinned (S-26)", () => {
    const sources = readFileSync("corpus/SOURCES.md", "utf8");
    expect(sha256("corpus/LICENSE-2.0.txt")).toBe(APACHE_LICENSE_SHA256);
    for (const file of ["corpus/LICENSE", "corpus/LICENSE-2.0.txt"]) {
      expect(sources, file).toContain(`\`${sha256(file)}\``);
    }
  });
});

/** The integers start..end, inclusive. */
function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/** The "### " lines outside fenced code, whose fences are all ``` at column 0. */
function subheadings(lines: string[]): string[] {
  let code = false;
  return lines.filter((line) => {
    if (line.startsWith("```")) code = !code;
    return !code && line.startsWith("### ");
  });
}

// Checks written apart from lib/rag/chunk.ts, on the pinned files (spec §4.1, S-22).
describe("the chunks of the committed corpus", () => {
  const chunks = chunkCorpus(files);
  const contents = new Map(files.map(({ file, content }) => [file, content]));

  it("cover every line after the frontmatter exactly once, in order", () => {
    for (const { file, content } of files) {
      const lines = content.split("\n");
      expect(lines.at(-1), `${file} ends with a newline`).toBe("");
      const firstBodyLine = lines.indexOf("---", 1) + 2;
      const covered = chunks
        .filter((chunk) => chunk.file === file)
        .flatMap(({ startLine, endLine }) => range(startLine, endLine));
      expect(covered, file).toEqual(range(firstBodyLine, lines.length - 1));
    }
  });

  it("hold exactly the file's raw lines startLine..endLine", () => {
    for (const { id, file, startLine, endLine, text } of chunks) {
      const lines = contents.get(file)!.split("\n");
      expect(text, id).toBe(lines.slice(startLine - 1, endLine).join("\n"));
    }
  });

  it("never split a fenced code block", () => {
    // The count below assumes every fence is ``` at column 0, as in the pinned files.
    const fenceLines = files.flatMap(({ content }) =>
      content.split("\n").filter((line) => /^\s*(```|~~~)/.test(line)),
    );
    expect(fenceLines.every((line) => line.startsWith("```"))).toBe(true);
    for (const { id, text } of chunks) {
      const fences = text.split("\n").filter((line) => line.startsWith("```"));
      expect(fences.length % 2, id).toBe(0);
    }
  });

  it("are headed by the file's title, then by their own first line's heading", () => {
    for (const { id, file, heading, text } of chunks) {
      const [title, ...path] = heading.split(" › ");
      expect(title, id).toBe(/^title: (.*)$/m.exec(contents.get(file)!)?.[1]);
      if (path.length > 0) {
        expect(text.split("\n")[0], id).toBe(`${"#".repeat(path.length + 1)} ${path.at(-1)}`);
      }
    }
  });

  it("have unique ids", () => {
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
  });

  it("are longer than MAX_SECTION_WORDS only when no ### heading is left to split at", () => {
    const long = chunks.filter((chunk) => countWords(chunk.text) > MAX_SECTION_WORDS);
    for (const { id, text } of long) {
      expect(subheadings(text.split("\n").slice(1)), id).toEqual([]);
    }
  });
});

/** A passage's first, middle and last runs of n words, joined by single spaces. */
function quotesFrom(text: string, n: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < n) return [];
  const starts = [0, Math.floor((words.length - n) / 2), words.length - n];
  return starts.map((start) => words.slice(start, start + n).join(" "));
}

// verifyQuote on the real MDX passages (spec §6.3): a phrase copied from a passage is verified,
// and its mark holds that phrase, so the quote is literally at the GitHub link (spec §4.1).
describe("quotes copied from the committed passages", () => {
  it("are verified, and their mark holds the quote", () => {
    for (const { id, text } of chunkCorpus(files)) {
      for (const quote of quotesFrom(text, 10)) {
        const result = verifyQuote(quote, text);
        const mark = result.status === "verified" ? text.slice(result.start, result.end) : null;
        expect(mark && normalise(mark), `${id}: ${quote}`).toBe(normalise(quote));
      }
    }
  });
});

// A stale index fails here: rebuild it with `pnpm build-index` (spec §4.3, §14).
describe("corpus/index.json", () => {
  const index = readIndexFile();

  it("is the file at INDEX_PATH", () => {
    expect(index).toStrictEqual(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
  });

  it("was built from the committed corpus", () => {
    expect(index.corpusHash).toBe(corpusHash(files));
    expect(index.tag).toBe(CORPUS_TAG);
    expect(index.commit).toBe(CORPUS_COMMIT);
  });

  it("holds exactly the chunks the chunker makes from the committed corpus (S-25)", () => {
    const committed = index.chunks.map(({ id, file, heading, startLine, endLine, text }) => ({
      id,
      file,
      heading,
      startLine,
      endLine,
      text,
    }));
    expect(committed).toEqual(chunkCorpus(files));
  });
});

// `pnpm format` and `pnpm lint` must never rewrite or judge the upstream files (spec §3).
describe("corpus/", () => {
  it("is ignored by Prettier", () => {
    const fileInfo = (file: string) =>
      JSON.parse(
        execFileSync("node_modules/.bin/prettier", ["--file-info", file], { encoding: "utf8" }),
      );
    expect(fileInfo(`${CORPUS_DIR}/30-embeddings.mdx`)).toMatchObject({ ignored: true });
    expect(fileInfo("corpus/SOURCES.md")).toMatchObject({ ignored: true });
    expect(fileInfo("README.md")).toMatchObject({ ignored: false });
  }, 30_000);

  it("is ignored by ESLint", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    expect(await eslint.isPathIgnored("corpus/example.ts")).toBe(true);
    expect(await eslint.isPathIgnored("lib/rag/corpus.ts")).toBe(false);
  }, 30_000);
});
