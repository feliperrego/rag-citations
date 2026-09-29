import { describe, expect, it } from "vitest";
import type { Chunk } from "./chunk";
import { toSources } from "./message";

function chunk(id: string, startLine: number, endLine: number): Chunk {
  return {
    id,
    file: `${id}.mdx`,
    heading: `Title › ${id}`,
    startLine,
    endLine,
    text: `## ${id}\n\nText of ${id}.\n`,
  };
}

describe("toSources", () => {
  it("numbers the passages from 1 in rank order, with text, lines, GitHub link and score", () => {
    const results = [
      { chunk: chunk("30-embeddings", 12, 40), score: 0.61 },
      { chunk: chunk("31-reranking", 5, 9), score: 0.42 },
    ];
    expect(toSources(results)).toEqual([
      {
        number: 1,
        file: "30-embeddings.mdx",
        heading: "Title › 30-embeddings",
        startLine: 12,
        endLine: 40,
        text: "## 30-embeddings\n\nText of 30-embeddings.\n",
        url:
          "https://github.com/vercel/ai/blob/3f3a717e2237c56aed9fab22269f07ccfeb0a142/" +
          "content/docs/03-ai-sdk-core/30-embeddings.mdx?plain=1#L12-L40",
        score: 0.61,
      },
      {
        number: 2,
        file: "31-reranking.mdx",
        heading: "Title › 31-reranking",
        startLine: 5,
        endLine: 9,
        text: "## 31-reranking\n\nText of 31-reranking.\n",
        url:
          "https://github.com/vercel/ai/blob/3f3a717e2237c56aed9fab22269f07ccfeb0a142/" +
          "content/docs/03-ai-sdk-core/31-reranking.mdx?plain=1#L5-L9",
        score: 0.42,
      },
    ]);
  });

  it("returns no sources for no results", () => {
    expect(toSources([])).toEqual([]);
  });
});
