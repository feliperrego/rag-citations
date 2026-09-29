import type { Chunk } from "./chunk";
import { CORPUS_COMMIT, CORPUS_REPO, CORPUS_REPO_PATH } from "./config";

/**
 * The passage's lines on GitHub, in the file at the pinned commit (spec §7, R-13). GitHub
 * renders .mdx as Markdown, where #L anchors select nothing, so the link asks for ?plain=1.
 */
export function sourceUrl({
  file,
  startLine,
  endLine,
}: Pick<Chunk, "file" | "startLine" | "endLine">): string {
  const blob = `https://github.com/${CORPUS_REPO}/blob/${CORPUS_COMMIT}`;
  return `${blob}/${CORPUS_REPO_PATH}/${encodeURIComponent(file)}?plain=1#L${startLine}-L${endLine}`;
}
