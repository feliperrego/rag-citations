import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { APACHE_LICENSE_SHA256, CORPUS_COMMIT, CORPUS_DIR, CORPUS_TAG } from "@/lib/rag/config";
import { corpusHash, corpusManifest, readCorpus } from "@/lib/rag/corpus";

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
