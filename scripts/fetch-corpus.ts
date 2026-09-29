/**
 * Fetches the pinned corpus byte for byte (spec §3, S-26): the .mdx files of the AI SDK Core
 * docs at CORPUS_COMMIT, the upstream LICENSE notice and the full Apache-2.0 text. Each GitHub
 * file is checked against its git blob SHA, and the Apache-2.0 text against its pinned SHA-256,
 * before anything is written. Then it writes corpus/SHA256SUMS and prints the manifest and the
 * figures corpus/SOURCES.md records.
 *
 * Run from the repo root, with the GitHub CLI signed in: pnpm fetch-corpus
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  APACHE_LICENSE_SHA256,
  CORPUS_COMMIT,
  CORPUS_DIR,
  CORPUS_REPO,
  CORPUS_REPO_PATH,
  CORPUS_TAG,
} from "@/lib/rag/config";
import { corpusHash, corpusManifest, readCorpus } from "@/lib/rag/corpus";

const APACHE_LICENSE_URL = "https://www.apache.org/licenses/LICENSE-2.0.txt";
const NOTICE_PATH = "corpus/LICENSE";
const LICENSE_PATH = "corpus/LICENSE-2.0.txt";
const MANIFEST_PATH = "corpus/SHA256SUMS";

type Entry = { name: string; path: string; type: string; sha: string };
type Blob = Entry & { encoding: string; content: string };

/** A GET through the GitHub CLI, which carries the user's sign-in and rate limit. */
function gh<T>(endpoint: string): T {
  const json = execFileSync("gh", ["api", endpoint], { encoding: "utf8", maxBuffer: 1 << 26 });
  return JSON.parse(json) as T;
}

function contents<T>(repoPath: string): T {
  return gh<T>(`repos/${CORPUS_REPO}/contents/${repoPath}?ref=${CORPUS_COMMIT}`);
}

/** Git's id for a blob, which the contents API reports as `sha`. */
function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A file's exact bytes at the pinned commit. */
function fetchBlob(repoPath: string): Buffer {
  const blob = contents<Blob>(repoPath);
  const bytes = Buffer.from(blob.content, "base64");
  if (blob.encoding !== "base64" || gitBlobSha(bytes) !== blob.sha) {
    throw new Error(`${repoPath} does not match its git blob ${blob.sha}`);
  }
  return bytes;
}

async function main(): Promise<void> {
  const ref = gh<{ object: { type: string; sha: string } }>(
    `repos/${CORPUS_REPO}/git/refs/tags/${CORPUS_TAG}`,
  );
  if (ref.object.type !== "commit" || ref.object.sha !== CORPUS_COMMIT) {
    throw new Error(`${CORPUS_TAG} points to ${ref.object.type} ${ref.object.sha}`);
  }

  const entries = contents<Entry[]>(CORPUS_REPO_PATH);
  const unexpected = entries.filter((e) => e.type !== "file" || !e.name.endsWith(".mdx"));
  if (unexpected.length > 0) {
    throw new Error(`Not an .mdx file: ${unexpected.map((e) => e.path).join(", ")}`);
  }

  const blobs = entries.map((entry) => ({ name: entry.name, bytes: fetchBlob(entry.path) }));
  const notice = fetchBlob("LICENSE");
  const response = await fetch(APACHE_LICENSE_URL);
  if (!response.ok) throw new Error(`${APACHE_LICENSE_URL} answered ${response.status}`);
  const license = Buffer.from(await response.arrayBuffer());
  if (sha256(license) !== APACHE_LICENSE_SHA256) {
    throw new Error(
      `${APACHE_LICENSE_URL} does not match its pinned SHA-256 ${APACHE_LICENSE_SHA256}`,
    );
  }

  // Everything arrived and checked out. Start from an empty directory, so a file removed
  // upstream does not linger.
  rmSync(CORPUS_DIR, { recursive: true, force: true });
  mkdirSync(CORPUS_DIR, { recursive: true });
  for (const { name, bytes } of blobs) writeFileSync(`${CORPUS_DIR}/${name}`, bytes);
  writeFileSync(NOTICE_PATH, notice);
  writeFileSync(LICENSE_PATH, license);

  const files = readCorpus(CORPUS_DIR);
  const manifest = corpusManifest(files);
  writeFileSync(MANIFEST_PATH, manifest);
  const bytes = files.reduce((sum, { content }) => sum + Buffer.byteLength(content, "utf8"), 0);

  process.stdout.write(manifest);
  console.log(`
Source:      github.com/${CORPUS_REPO}/tree/${CORPUS_COMMIT}/${CORPUS_REPO_PATH}
Tag:         ${CORPUS_TAG} -> ${CORPUS_COMMIT}
Fetched:     ${new Date().toISOString().slice(0, 10)} (UTC)
Files:       ${files.length} .mdx files, ${bytes.toLocaleString("en-US")} bytes
Corpus hash: ${corpusHash(files)}
${sha256(readFileSync(NOTICE_PATH))}  ${NOTICE_PATH}
${sha256(readFileSync(LICENSE_PATH))}  ${LICENSE_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
