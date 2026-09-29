# RAG with Citations — citation verification rate: pending the first production measurement

[![CI](https://github.com/feliperrego/rag-citations/actions/workflows/ci.yml/badge.svg)](https://github.com/feliperrego/rag-citations/actions/workflows/ci.yml) · **[Live demo](https://rag-citations-five.vercel.app)** · Part of the [feliperrego.com](https://feliperrego.com) portfolio

## Problem
An answer generated from documents can cite a source that does not say what it claims, and the reader rarely has a quick way to check. This demo answers questions about the Vercel AI SDK only from its AI SDK Core docs, pinned to the SDK version the app runs. The model must cite a passage after each claim, with a quote copied from it; the screen checks every quote against its passage and links to the exact lines on GitHub, and a question the docs do not cover gets "I don't know".

## Decisions
- **The index is committed to the repo and searched in memory** instead of a vector database: the first production measurement prints its median search time here; a database waits for more than ~5,000 vectors or writes at runtime.
- **Citation UI hand-built on shadcn/ui** instead of AI Elements: the citation states are the skill this project shows; each `[n]` opens its passage with the quote marked, and its badge comes from the same check the measurement counts.
- **"I don't know" in two layers** instead of leaving it to the model: a similarity threshold refuses before any model call when no passage is close enough, and the model is told to refuse when its passages do not answer.

## How it's measured
Pending: the first production measurement prints this line: n, the answers by classification, the refusal accuracy, the unverified citations by status with their answers' ids, the model, the location, the days and a link to the raw data. A verified quote is in its passage word for word, allowing only whitespace, quote style, Unicode form and letter case; it does not prove that the passage supports the claim.
The share of citation attempts whose quote is found in the cited passage, read from each citation button's `data-citation-verified`, over the frozen English questions in [measurements/questions.json](measurements/questions.json), asked on the live demo in runs that each fit in one rate-limit hour: `MEASURE_URL=<url> MEASURE_LOCATION='<city, connection>' MEASURE_RUN=<run> pnpm exec playwright test --project=measure`, then `pnpm aggregate-citations`. Malformed citations count as unverified, answers without citations are listed as failures, and the interval is a seeded bootstrap over answers. Five of the questions are near-misses the docs do not cover: refusing them is correct, and they give the refusal accuracy, supporting data rather than a second headline ([spec §11](docs/specs/2026-09-28-rag-citations-design.md#11-the-measured-number)).
Caveats: one client location; Portuguese answers are checked by hand, not measured. Stop ends the stream up to the AI Gateway, but the Gateway still finishes and bills the generation, so Stop does not save tokens.

## Run it
`pnpm install && pnpm dev:mock` (no API key needed: a mock model answers, and a word-hash mock embeds the committed index in memory)

## Stack
Next.js · AI SDK · AI Gateway · shadcn/ui · Upstash · Playwright

## License
Code: [MIT](LICENSE). The AI SDK Core docs in `corpus/`, including the passage text in `corpus/index.json`, are licensed by Vercel under the Apache License 2.0, not MIT: see [corpus/SOURCES.md](corpus/SOURCES.md).
