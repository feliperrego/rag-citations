# RAG with Citations — 85% of citations verified verbatim (n=71 citations in 32 answers, 95% CI 74–94%)

[![CI](https://github.com/feliperrego/rag-citations/actions/workflows/ci.yml/badge.svg)](https://github.com/feliperrego/rag-citations/actions/workflows/ci.yml) · **[Live demo](https://rag-citations-five.vercel.app)** · Part of the [feliperrego.com](https://feliperrego.com) portfolio

## Problem
An answer generated from documents can cite a source that does not say what it claims, and the reader rarely has a quick way to check. This demo answers questions about the Vercel AI SDK only from its AI SDK Core docs, pinned to the SDK version the app runs. The model must cite a passage after each claim, with a quote copied from it; the screen checks every quote against its passage and links to the exact lines on GitHub, and a question the docs do not cover gets "I don't know".

## Decisions
- **The index is committed to the repo and searched in memory** instead of a vector database: a search over its 239 passages took a median 0.92 ms in production (45 questions); a database waits for more than ~5,000 vectors or writes at runtime.
- **Citation UI hand-built on shadcn/ui** instead of AI Elements: the citation states are the skill this project shows; each `[n]` opens its passage with the quote marked, and its badge comes from the same check the measurement counts.
- **"I don't know" in two layers** instead of leaving it to the model: a similarity threshold refuses before any model call when no passage is close enough, and the model is told to refuse when its passages do not answer.

## How it's measured
n=71 citations in 32 answers to 45 English questions (5 out of scope), openai/gpt-6-luna, measured from Fortaleza, home fibre, 2026-09-29, 3 runs; answers: with citations 32, without citations 0, gate refusal 10 (m03, m05, m09, m14, m24), model refusal 3 (m10, m21, m37); refusal accuracy: 5 of 5 out-of-scope refused (gate 5, model 0); in-scope refused: 8 of 40; citations not verified: not found 11, unknown source 0, malformed 0 (m07, m13, m17, m30, m31, m33, m34, m36). A verified quote is in its passage word for word, allowing only whitespace, quote style, Unicode form, letter case and a Markdown link written as its text; it does not prove that the passage supports the claim · [raw data](measurements/citations-2026-09-29.json)

The share of citation attempts whose quote is found in the cited passage, read from each citation button's `data-citation-verified`, over the frozen English questions in [measurements/questions.json](measurements/questions.json), asked on the live demo in runs that each fit in one rate-limit hour: `MEASURE_URL=<url> MEASURE_LOCATION='<city, connection>' MEASURE_RUN=<run> pnpm exec playwright test --project=measure`, then `pnpm aggregate-citations`. Malformed citations count as unverified, answers without citations are listed as failures, and the interval is a seeded bootstrap over answers. Five of the questions are near-misses the docs do not cover: refusing them is correct, and they give the refusal accuracy, supporting data rather than a second headline ([spec §11](docs/specs/2026-09-28-rag-citations-design.md#11-the-measured-number)).

Caveats: one client location; Portuguese answers are checked by hand, not measured. Stop ends the stream up to the AI Gateway, but the Gateway still finishes and bills the generation, so Stop does not save tokens.

## Run it
`pnpm install && pnpm dev:mock` (no API key needed: a mock model answers, and a word-hash mock embeds the committed index in memory)

## Stack
Next.js · AI SDK · AI Gateway · shadcn/ui · Upstash · Playwright

## License
Code: [MIT](LICENSE). The AI SDK Core docs in `corpus/`, including the passage text in `corpus/index.json`, are licensed by Vercel under the Apache License 2.0, not MIT: see [corpus/SOURCES.md](corpus/SOURCES.md).
