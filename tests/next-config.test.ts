import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDEX_PATH } from "@/lib/rag/config";
import nextConfig from "@/next.config";

describe("next.config.ts", () => {
  // The route reads the index from the file system, so the deploy must carry it (spec §4.4).
  it("ships corpus/index.json with the chat route", () => {
    expect(nextConfig.outputFileTracingIncludes).toEqual({ "/api/chat": [`./${INDEX_PATH}`] });
    expect(existsSync(INDEX_PATH)).toBe(true);
  });
});
