import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The chat route reads the index from the file system, so the deploy must carry it (spec §4.4).
  outputFileTracingIncludes: {
    "/api/chat": ["./corpus/index.json"],
  },
};

export default nextConfig;
