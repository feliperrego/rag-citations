import { describe, expect, it } from "vitest";
import { sourceUrl } from "./github";

describe("sourceUrl", () => {
  it("links the passage's lines in the plain view of the file at the pinned commit (spec §7)", () => {
    expect(sourceUrl({ file: "30-embeddings.mdx", startLine: 120, endLine: 141 })).toBe(
      "https://github.com/vercel/ai/blob/3f3a717e2237c56aed9fab22269f07ccfeb0a142" +
        "/content/docs/03-ai-sdk-core/30-embeddings.mdx?plain=1#L120-L141",
    );
  });

  it("links a one-line passage as a range of one line", () => {
    expect(sourceUrl({ file: "index.mdx", startLine: 5, endLine: 5 })).toMatch(
      /\/index\.mdx\?plain=1#L5-L5$/,
    );
  });

  it("encodes the file name as a path segment", () => {
    expect(sourceUrl({ file: "a b#c.mdx", startLine: 1, endLine: 2 })).toMatch(
      /\/a%20b%23c\.mdx\?plain=1#L1-L2$/,
    );
  });
});
