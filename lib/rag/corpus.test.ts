import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { corpusHash, corpusManifest, readCorpus } from "./corpus";

// Hashes computed outside the code under test, with `shasum -a 256 a.mdx b.mdx`.
const A = { file: "a.mdx", content: "first\n" };
const B = { file: "b.mdx", content: "second\n" };
const MANIFEST =
  "b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41  a.mdx\n" +
  "480c2336b410f1ad5f8bf1b28944490255804b65350c527787e74ebdd511e3a4  b.mdx\n";
// `shasum -a 256` of that manifest saved as a file.
const HASH = "b0e1bbd90121d50a78d75a0549d89fa1c15a898a47d2546fd39b83d89ca70b18";

describe("corpusManifest", () => {
  it("lists each file's SHA-256 in sha256sum format, sorted by file name", () => {
    expect(corpusManifest([B, A])).toBe(MANIFEST);
  });
});

describe("corpusHash", () => {
  it("is the SHA-256 of the manifest", () => {
    expect(corpusHash([A, B])).toBe(HASH);
  });

  it("does not depend on the order of its input", () => {
    expect(corpusHash([B, A])).toBe(HASH);
  });

  it("changes when a file's content changes", () => {
    expect(corpusHash([A, { ...B, content: "second \n" }])).not.toBe(HASH);
    expect(corpusHash([A, { ...B, content: "second\r\n" }])).not.toBe(HASH);
  });

  it("changes when a file is renamed, added or removed", () => {
    expect(corpusHash([A, { ...B, file: "c.mdx" }])).not.toBe(HASH);
    expect(corpusHash([A, B, { file: "c.mdx", content: "" }])).not.toBe(HASH);
    expect(corpusHash([A])).not.toBe(HASH);
  });

  it("rejects two files with the same name, whose order would change the hash", () => {
    expect(() => corpusHash([A, { ...A, content: "other\n" }])).toThrow(RangeError);
  });
});

describe("readCorpus", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "corpus-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads only the .mdx files directly inside the directory", () => {
    writeFileSync(path.join(dir, "a.mdx"), "first\n");
    writeFileSync(path.join(dir, "notes.md"), "not corpus\n");
    mkdirSync(path.join(dir, "nested.mdx"));
    writeFileSync(path.join(dir, "nested.mdx", "c.mdx"), "nested\n");
    expect(readCorpus(dir)).toEqual([{ file: "a.mdx", content: "first\n" }]);
  });

  it("sorts by file name in code-unit order, whatever the locale", () => {
    for (const file of ["index.mdx", "a.mdx", "Z.mdx", "10-b.mdx", "2-a.mdx"]) {
      writeFileSync(path.join(dir, file), file);
    }
    expect(readCorpus(dir).map((f) => f.file)).toEqual([
      "10-b.mdx",
      "2-a.mdx",
      "Z.mdx",
      "a.mdx",
      "index.mdx",
    ]);
  });

  it("keeps the bytes as they are: BOM, CRLF and a missing final newline", () => {
    const content = "﻿# Title\r\n\r\nNo final newline";
    writeFileSync(path.join(dir, "a.mdx"), content, "utf8");
    const [file] = readCorpus(dir);
    expect(file.content).toBe(content);
    expect(Buffer.from(file.content, "utf8")).toEqual(Buffer.from(content, "utf8"));
  });

  it("rejects a file that is not valid UTF-8, which could not be hashed as its bytes", () => {
    writeFileSync(path.join(dir, "a.mdx"), Buffer.from([0x61, 0xff, 0x62]));
    expect(() => readCorpus(dir)).toThrow(/a\.mdx is not valid UTF-8/);
  });
});
