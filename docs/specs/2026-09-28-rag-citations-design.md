# RAG with Citations (portfolio project #2) — design

- **Status:** approved 2026-09-28. Draft v1 was reviewed by three independent reviewers, each followed by a skeptic; the confirmed findings were applied in draft v2, whose open items (X-01, S-01 to S-28) Felipe approved "todas ok", with X-01 option (a).
- **Date:** 2026-09-28.
- **Author:** Felipe Rêgo (design drafted with Claude).
- **Template:** starts from `feliperrego/ai-portfolio-template`, after the template update of §13. The template spec is cited as "template §x". Project #1 (`feliperrego/streaming-chat`) is cited as "#1", and its specs as "#1 spec" and "#1 delta spec".

## How to read this document

| Tag | Meaning |
|---|---|
| `[F]` | Fact, with its source. |
| `[D]` | Decision taken by Felipe, with a reference. |
| `[P]` | Proposal or estimate, not yet confirmed. Estimates and inferences say so (`[P: arithmetic …]`, `[P: estimate]`, `[P: inference]`) and need no answer. The S-xx and X-01 items of §17 were approved and are cited as `[D: S-xx]`. A-07 to A-14 in §18 were approved on 2026-09-29. None is open. |

Decision references:

- **D-chat-1:** the portfolio conversation of 2026-09-24/25 (small projects, each with a live demo and one measured number, built from the shared template; everything public in English; the project list in `ROADMAP.md`).
- **D-chat-3:** the design conversation for this project, 2026-09-28. Felipe chose:
  - the corpus: the AI SDK Core docs;
  - the vectors: an index committed to the repo and searched in memory, with the README explaining why, with a measurement;
  - the headline number: the share of citations verified verbatim;
  - "I don't know": a similarity threshold before the model, and the model may still refuse;
  - the language: English by default plus a pt-BR switch, as in #1;
  - approach A (§2).
  Design sections 1–3 were then approved "todas ok". Those proposals, R-01 to R-23, are recorded verbatim in Appendix A and cited as `[D: R-xx]`.
- **Research brief** (2026-09-28, read-only): five researchers plus a synthesis. Cited as `[F: brief]` when the brief checked the fact itself; otherwise the underlying source is named.

## 1. Purpose and success criteria

**Purpose.** A recruiter asks a question about the Vercel AI SDK and gets a short answer. Every claim links to the exact passage it came from, and the quote inside each citation is checked against that passage on screen. A question the docs do not cover gets "I don't know". The project proves embeddings, vector search and grounded generation, with the portfolio's rules: a live demo, one measured number, and zero-cost tests.

**Success criteria** [D: S-04]:

1. A suggested in-scope question gets an answer with at least one `[n]` citation. Each citation shows one of three statuses: verified, not found, or no such source. For the first two, it shows its passage and a link to the exact lines on GitHub.
2. The out-of-scope suggested question is refused by the gate, with no language-model call, in English and in Portuguese.
3. The EN/PT switch translates every interface string. Under the Portuguese interface, a Portuguese question gets a Portuguese answer, with quotes kept in English [D: R-12].
4. All tests run in CI with no secret and no model cost.
5. The README's first line states the verified-citation rate, measured on the live demo by a script. The number is never typed by hand.

## 2. Approach and scope

**Approach A** [D-chat-3]: embed the question → search the index in memory → threshold gate → stream the passages, then the model's answer with inline citations → the screen verifies each quote with the same function the measurement uses.

Rejected: B, a search tool the model calls, because it overlaps project #6 and blurs the gate; C, a structured answer with no streaming, because it loses the chat and the streaming.

**Not in #2, each with the event that would bring it back:**

| Not in #2 | Why | Trigger |
|---|---|---|
| A vector database | [D-chat-3]. About 300 vectors are searched far under 1 ms in memory [F: brief, local benchmark of 0.32 ms for top-5 over 1536×300]. The README shows the figure measured by script (§11) | more than ~5,000 vectors, writes at runtime, or project #14 starts [D-chat-3]. Then a vector-database adapter goes behind the same `VectorStore` interface; which database is decided at the trigger |
| Follow-up questions that need history (query rewriting) | each question is retrieved on its own [D: R-06] | the limitation shows up in real use [D: R-06] |
| A reranker | out of #2's scope [D: S-15] | #3's design chooses its one improvement; reranking is a candidate [D: S-15] |
| Comparing chunking strategies | that is #4 [F: ROADMAP.md] | #4 starts |
| Comparing with keyword search | that is #14 [F: ROADMAP.md] | #14 starts |
| Markdown or code blocks in answers | plain text, as in #1 [D: R-10] | a script over `measurements/citations-*.json` counts more than 4 of the ~40 answers with code-like text outside backticks, such as `=>`, `{` or `import` [D: S-14] |
| "About Felipe" prompts | the RAG answers only from the docs [D: R-16] | — |
| AI Elements | template rule: chat UIs are hand-built on shadcn/ui [F: template spec line 58] | — |
| Embeddings, i18n and the chat shell in the template | [D: R-08]. The template's own chat-components trigger has fired (§13); X-01 moves it | when #2 ships, before the next chat project (#6) starts: extract the shared shell and i18n into the template, from #1 and #2 [D: X-01] |

## 3. Corpus

- **Source** [D: R-02]: the directory `content/docs/03-ai-sdk-core` of `github.com/vercel/ai` at tag `ai@7.0.114`, the SDK version the app runs.
  - The tag resolves to commit `3f3a717e2237c56aed9fab22269f07ccfeb0a142` [F: `gh api repos/vercel/ai/git/refs/tags/ai@7.0.114`, 2026-09-28].
  - The directory holds **32 `.mdx` files, 450,783 bytes** at that commit [F: `gh api …/contents/content/docs/03-ai-sdk-core?ref=ai@7.0.114`].
- **License** [F]:
  - The repo's `LICENSE` at the tag is the Apache License 2.0 notice, "Copyright 2023 Vercel, Inc." [F: file content]. There is no `NOTICE` file [F: 404 at the tag]. GitHub's license detector reports `NOASSERTION` for that short notice [F: `gh api repos/vercel/ai/license`].
  - Felipe chose this corpus knowing it is Apache-2.0 [D-chat-3].
- **Storage:**
  - `corpus/SOURCES.md` records the URL, tag, commit, date and license facts, and `corpus/LICENSE` holds the upstream notice verbatim [D: R-02].
  - `corpus/LICENSE-2.0.txt` holds the full Apache-2.0 text, because Apache-2.0 §4(a) requires a copy of the License itself, not only the notice [D: S-26].
  - The 32 files are committed unmodified under `corpus/ai-sdk-core/` [D: S-26]. SOURCES.md says that `corpus/` and the chunk text inside `corpus/index.json` are Apache-2.0, not the repo's MIT, and that the index is derived from the unmodified files.
- **Cost to embed:** 450,783 bytes is about 110K tokens, so the whole corpus costs about US$ 0.002 [P: arithmetic on the F price of US$ 0.02 per 1M tokens].

## 4. The index

### 4.1 Chunks and the one passage string [D: R-03; details D: S-22, S-25]

- One chunk per `##` section; the text before the first `##` is the file's intro chunk. Fenced code blocks are never split.
- A section longer than `MAX_SECTION_WORDS = 1500` whitespace-separated words is split at its `###` headings. A `###` subsection that is still longer stays whole.
- **One passage string per chunk: `chunk.text`**, which is the raw file lines `startLine..endLine` with the YAML frontmatter excluded and nothing else changed. Markdown, links, JSX such as `<Note>`, and fenced code (including its `import` lines) stay as they are.
  - The prompt shows it, `data-sources` carries it, `verifyQuote` checks it, the popover marks it, and the chat mock copies from it. So a verified quote is literally present at the GitHub link.
  - The pinned corpus has no MDX `import`/`export` lines outside code fences [F: script over the corpus, per review], so nothing is stripped.
- Each chunk carries `id`, `file`, `heading` (path such as "Embeddings › Settings"), `startLine`, `endLine` (1-based) and `text`.
- The chunk count is known only after the build: about 250–300 by estimate [P: estimate].

### 4.2 `corpus/index.json` [D: S-07]

- It records `model`, `dimensions`, `corpusHash` (sha256 of the sorted corpus files), `tag`, `commit`, `builtAt` and the chunks. The vector encoding (rounded decimals or base64 float32) is chosen in the prototype by file size [D: S-07].
- **Two build modes of `scripts/build-index.ts`:**
  - **Mock mode** (`AI_MOCK=1`), zero cost: writes the real chunks with `model: "mock"`, `dimensions: null` and no vectors. It is committed in step 1, so CI, the e2e tests and Preview have an index.
  - **Real mode**, run by hand in step 3 with Felipe's OK: the same file, with `model`, `dimensions` and vectors from one `embedMany` call through the Gateway, whose `maxEmbeddingsPerCall` is 2048 [F: brief, gateway-embedding-model.ts:31].
- **Where the embedding model id lives** [D: S-18]: `build-index.ts` reads it from `EMBEDDING_MODEL` (in `.env.example`), following template §7.1 (model ids only in env vars). At runtime the route embeds the question with the index's own `model` field, so there is one source and nothing to mismatch.
- **Model:** `openai/text-embedding-3-small`, 1536 dimensions, US$ 0.02 per 1M input tokens [F: brief; AI SDK docs 30-embeddings.mdx:225; Gateway model page], 8,192-token input cap [F: OpenAI embeddings guide].

### 4.3 Loading rules and guards [D: S-07]

- **Mock mode** ignores the stored vectors and model: it re-embeds every `chunk.text` with the mock embedder in memory, at the first request [D: R-19].
- **Real mode** throws at load when the vectors are missing, when `model` is `"mock"`, or when `REFUSAL_THRESHOLD` is unset. So a production deploy before step 3 fails loudly.
- The first query embedding's length must equal `dimensions`; otherwise the route fails with the generic error.
- Unit tests (zero cost):
  - the corpus hash matches the committed corpus;
  - re-running the chunker over the committed corpus gives exactly the committed chunks (`id`, `file`, `heading`, lines, `text`), so a chunker change without a rebuild fails [D: S-25];
  - one test per loading rule.

### 4.4 Search

- `cosineSimilarity` from `ai` over every chunk, keeping the top k = 5 [D: R-04]. It returns 0 for a zero vector and throws on a length mismatch [F: brief, index.d.ts:8065-8075].
- It sits behind a small `VectorStore` interface, `search(vector, k)` [D-chat-3].
- The file is read from the file system; `outputFileTracingIncludes` ships it with the route [F: brief, Vercel limits doc].
- The route records the search time in milliseconds in the message metadata (`searchMs`), which the measurement reads (§11) [D: S-08].

## 5. One request

The chat route runs these steps in order [D: S-17 for step 3]:

1. Rate limit, 20 requests per hour per IP [F: template spec].
2. 415 for a non-JSON body (§13).
3. **Validation and the query.** The client sends only the latest user message, through `prepareSendMessagesRequest`; the server rejects any other shape. The query is that message's text. #1's 20-message conversation cap does not apply, because no history is sent [D: S-17].
4. Embed the question with `embed({ model: index.model, value })`. A plain Gateway model string works [F: brief, resolve-model.ts:52-55].
5. Search the top 5 chunks.
6. **Gate** (§8). If the best score is below the threshold, the stream carries message metadata `{ refusal: "gate", topScore, threshold, searchMs }` and the fixed refusal sentence in the **interface language** as text, then finishes. No `data-sources` part is sent, and the language model is not called [D: S-09, S-24].
7. **Otherwise**, inside `createUIMessageStream({ execute })` [F: brief, index.d.ts:6240; 20-streaming-data.mdx:64-121]:
   1. `writer.write({ type: "start" })`, then the message metadata `{ topScore, threshold, searchMs }`;
   2. a `data-sources` part with the 5 chunks: number, file, heading, lines, `text`, GitHub URL, score. Sources travel as a typed data part because `source-document` has no text field and `sendSources` forwards only sources the model emits [F: brief, index.d.ts:2060-2067, 2760-2763];
   3. `writer.merge(toUIMessageStream({ stream: result.stream, sendStart: false, sendReasoning: false, onError: toSafeErrorMessage }))`, the standalone helper #1's route uses. The method form is deprecated in `ai@7.0.114` [F: review, index.d.ts; #1 app/api/chat/route.ts].
8. **Model call** [D: R-05]: `openai/gpt-6-luna`, `maxOutputTokens: 1024`, `reasoning: "none"`, cancellation wired as in #1. The system instructions (§6.1), the numbered passages, and an interface-language line when the request carries `locale`, as in #1 [F: #1 delta spec §3.3].
   - Stop ends the stream up to the Gateway, but the Gateway still finishes and bills the generation [F: #1 spec §14 A-20]. The README says so, as #1's does.
- **Cost per answer:** about US$ 0.0008 on average (about 2.3K input tokens plus up to 1,024 output tokens), at most about US$ 0.002 with the five largest chunks [P: arithmetic on the F prices of US$ 0.1 and US$ 0.5 per 1M tokens]. A gate refusal costs only the question's embedding.

## 6. Citations and verification

### 6.1 What the model is told [D: S-01; the quote-language rule is D: R-12]

The two refusal sentences below are generated from the dictionary's `refusal` entries (§7.1), so they cannot drift apart.

```text
You answer questions about the Vercel AI SDK using only the numbered passages below,
taken from the AI SDK Core documentation at version 7.0.114.
1. Use only the passages. If they do not answer the question, reply with exactly this
   sentence and nothing else, in the language of the question:
   English: "I don't know. The AI SDK Core docs I search don't cover that."
   Portuguese: "Não sei. A documentação do AI SDK Core que eu consulto não cobre isso."
2. After each claim, cite its passage as [n: "quote"], where n is the passage number and
   quote is 3 to 25 words copied exactly from that passage. Keep quotes in English, the
   language of the passages, even when you answer in Portuguese.
3. Answer in the language of the user's question. If that is unclear, use the interface
   language stated at the end of these instructions, or English if none is stated.
4. Plain text only: no headings, lists or code blocks. Wrap API names in backticks.
5. Keep answers between 60 and 180 words.
```

### 6.2 Parsing [D: R-09; grammar D: S-23]

- **Grammar:** a well-formed marker matches `\[(\d{1,2})\s*:\s*["“](.+?)["”]\]`. The quote closes at the first `"]` (or `”]`), and straight or curly double quotes are accepted as delimiters.
- Markers are parsed first, on the **raw accumulated** text, never on single stream chunks, because a marker can be split across chunks [F: brief, Perplexity streaming-citations cookbook]. Backticks render as `<code>` only in the text between markers. There is no Markdown library [D: R-10].
- **A citation attempt** [D: S-12] is any of:
  - a well-formed marker;
  - a bracketed number reference outside code spans that does not match the grammar, such as `[2]` or `[1, 3: "…"]`;
  - an unfinished marker, meaning a text suffix that matches the marker-prefix pattern.
- An unfinished marker stays hidden only while streaming. When the stream ends, it is shown as plain text and counts as malformed.

### 6.3 Verification [D: R-11, R-14; normalisation D: S-11, A-14]

- `verifyQuote(quote, passage)` is a pure function. It returns a status and, when verified, the match's start and end offsets in the original passage, for the `<mark>`.
- **Normalisation, the whole list** [D: S-11, A-14]: Markdown links reduced to their text; NFKC; curly quotes and dashes made straight; whitespace collapsed; case-folded. It is applied to both strings. Other Markdown and MDX syntax (backticks, `**`, JSX) is compared as it is. Until A-14, links were compared as they are too.
- A quote must have 3–25 words.
- Statuses [D: R-11; D: S-12 for malformed]:
  - `verified`;
  - `not-found`: the quote is not in the passage, or it has the wrong length, or it contains `"]`;
  - `unknown-source`: `n` is outside 1–5;
  - `malformed`: a citation attempt that is not a well-formed marker. It counts in the denominator.
- **One code path** [D: R-14]: the same result draws the badge on screen and sets `data-citation-verified="true|false"` on each inline `[n]` button, and only there, one per attempt. The measurement script reads it, as #1's script read `data-ttft-ms` [F: #1 spec §5.2, §5.4].
- A verified quote proves the words are in the passage, not that the passage supports the claim [F: brief, Gao et al. 2023]. The README states this caveat, and says what "verbatim" allows: whitespace, quote style, Unicode form, letter case and a Markdown link written as its text [D: S-11, A-14].

## 7. The interface

- **Shell** [D: R-07]: #1's chat, copied: composer, Stop/Esc, Regenerate, autoscroll, banners, the 20/hour note, New chat, EN/PT switch, footer. #1's time-to-first-token caption is dropped.
- **Empty state:** a title, a subtitle, and a line saying the answers come only from the AI SDK Core docs at version 7.0.114. Four suggested questions: three answerable and one out of scope [D: R-15; wording D: S-02]. The three answers were found in the pinned files [F: `gh api`, 2026-09-28]: `maxParallelCalls` in `30-embeddings.mdx` "Settings"; `MockLanguageModelV4` in `55-testing.mdx`; reranking in `31-reranking.mdx` "Reranking Documents".
- **Answer:**
  - Plain text with `<code>` names and `[n]` buttons.
  - `[n]` opens a popover (shadcn base-nova maps it to `@base-ui/react/popover` [F: brief]) with the file and heading, the passage with the quote marked by `<mark>`, the status badge, and "View source on GitHub" [D: R-13]. The link is `https://github.com/vercel/ai/blob/<commit>/content/docs/03-ai-sdk-core/<file>?plain=1#L<startLine>-L<endLine>`. GitHub renders `.mdx` as Markdown, where `#L` anchors select nothing unless `?plain=1` is present [F: review, GitHub docs]. One pure function builds it, with a unit test.
  - An `unknown-source` button opens "No such source", with no passage and no link.
  - **Sources**, always visible below the answer [D: R-13]: the distinct cited passages in order of first citation, each with its per-quote result, such as "1 of 2 quotes verified". Retrieved passages that were not cited are not listed [D: S-16]. Nothing depends on hover, which is inaccessible on touch and to screen readers [F: brief, base-ui.com].
- **Refusal** [D: R-17 for the text; D: S-24 for the rest]:
  - A gate refusal carries `refusal: "gate"` in its metadata. The message gets `data-refusal="gate"`.
  - A model refusal is a finished answer whose normalised text equals either refusal sentence exactly. It gets `data-refusal="model"`.
  - With either value, the Sources list is hidden. Regenerate stays, as in #1.
- **Touch and accessibility:** #1's rules: 44 px targets on coarse pointers, and the popover opens and closes by keyboard. The `[n]` buttons are named "Source n" / "Fonte n".

### 7.1 Strings [D: S-03; R-21]

English values are the ones the page shows; pt-BR values are for Felipe to review. Keys reused from #1's approved dictionary keep #1's text: `composer.*`, `list.*` (without `ttft`), `chat.*`, `errors.*`, `status.*`, `header.*`, `footer.*` and `empty.rateNote` ("{n} messages/hour per visitor; regenerations count").

| Key | English | pt-BR |
|---|---|---|
| `empty.title` | Ask the AI SDK Core docs | Pergunte à documentação do AI SDK Core |
| `empty.subtitle` | Every answer cites the passage it used, and each quote is checked against the source. | Cada resposta cita o trecho que usou, e cada citação é conferida com a fonte. |
| `empty.corpusNote` | Answers come only from the AI SDK Core docs, version {version}. | As respostas vêm só da documentação do AI SDK Core, versão {version}. |
| `prompts[0]` | How do I embed many values in parallel? | Como gerar embeddings de vários textos em paralelo? |
| `prompts[1]` | How can I test my code without calling a real model? | Como testar meu código sem chamar um modelo de verdade? |
| `prompts[2]` | How do I rerank search results? | Como reordenar resultados de busca (rerank)? |
| `prompts[3]` (out of scope) | How do I enable dark mode in Tailwind CSS? | Como ativo o modo escuro no Tailwind CSS? |
| `sources.title` | Sources | Fontes |
| `sources.summary` | {verified} of {total} quotes verified | {verified} de {total} citações verificadas |
| `citation.button` | Source {n} | Fonte {n} |
| `citation.verified` | Quote verified | Citação verificada |
| `citation.notFound` | Quote not found in source | Citação não encontrada na fonte |
| `citation.malformed` | Citation not in the expected format | Citação fora do formato esperado |
| `citation.unknownSource` | No such source | Fonte inexistente |
| `citation.viewSource` | View source on GitHub | Ver fonte no GitHub |
| `refusal` | I don't know. The AI SDK Core docs I search don't cover that. | Não sei. A documentação do AI SDK Core que eu consulto não cobre isso. |

The product name "RAG with Citations", the model id and "Felipe Rêgo" stay untranslated.

## 8. "I don't know" and the threshold

- **Two layers** [D-chat-3]: the gate (best score < `REFUSAL_THRESHOLD`, no language-model call) and the model (rule 1 of §6.1).
- **Languages** [D: S-09]: the gate refuses in the interface language, because the route cannot detect the question's language without a model call; the model refuses in the question's language. Route tests cover one case per layer.
- **Calibration** [D: R-18; details D: S-06]:
  - `scripts/calibrate.ts` embeds `calibration/questions.json` and prints the scores; it costs about US$ 0. The set is written and committed before any score is seen. It has at least 15 answerable and 15 near-miss out-of-scope questions in each language [D: S-06], where near-miss means an AI or web topic the docs do not cover. Questions are assumed to be typed in the interface language.
  - **Rule, fixed now:**
    1. A threshold `t` separates a group when every answerable question scores ≥ `t` and every out-of-scope question scores < `t`. The gate refuses when the best score < `t`.
    2. If some `t` separates the EN and PT questions together, use the midpoint between the lowest answerable score and the highest out-of-scope score [D: S-06].
    3. Otherwise apply rule 2 to EN and to PT separately, and key the two thresholds by interface language [D: R-18].
    4. If a language still does not separate, use the `t` that misclassifies the fewest questions, taking the lowest such `t` on ties, since the model is the second layer. The errors are recorded in §16 [D: S-06].
  - The rule is a pure function with unit tests on synthetic score lists. The chosen value is frozen in `lib/rag/config.ts` with the date and the calibration file's hash.
  - **Suggested prompts** [D: S-28]: after freezing, `calibrate.ts` prints each suggested prompt's score in EN and PT against the threshold. A prompt on the wrong side is reworded and goes back to Felipe (S-02). The threshold never moves.
  - The calibration set never overlaps the measurement set [D: R-20].
- **Mock mode** [D: R-19; details D: S-27]:
  - The mock threshold is pinned by a unit test against the mock index built from `index.json`. The test asserts that the three EN in-scope suggested prompts and every e2e scenario question score ≥ `t`, and that the EN and PT out-of-scope prompts score < `t`.
  - In mock mode (CI and Preview) a PT in-scope prompt may be refused, so the PT e2e covers the interface strings and the refusal only.

## 9. Interface language

- It follows #1's pattern, copied, not imported [D: R-21]: a typed dictionary; the locale resolved from `?lang=` and storage; a provider with a module-level store read through `useSyncExternalStore`; the page prerendered in English; the locale sent in the POST body.
- The template's "i18n: never" row is superseded, for #1 by its delta spec and for #2 by D-chat-3. §13 corrects the template doc.
- Questions may be in either language. The embeddings search English passages across languages; Portuguese questions score lower, which is why §8 calibrates with both [P: inference].

## 10. Tests (all zero cost)

- **Mocks** [D: S-27]:
  - The embedding mock is `MockEmbeddingModelV4` from `ai/test`, with `maxEmbeddingsPerCall`, `supportsParallelCalls` and `doEmbed` overridden; the defaults are 1, false and not-implemented [F: brief, ai/dist/test/index.js:67-94]. `doEmbed` hashes words into a fixed-size vector, so similarity follows word overlap. The tokenizer is pinned by the mock-threshold test (§8).
  - The chat mock follows #1's pattern: it answers with `[n: "…"]` quotes copied from the passages it received, so the real verification path runs. Scenarios are triggered by magic tokens appended to an in-scope English question, as #1 did with `[[slow]]` and `[[error]]`: a quote not in its passage, an unknown source, a malformed marker, a model refusal, a slow answer, an error.
- **Unit (Vitest):** the chunker (sections, fences, `###` split, lines) and its re-run check; the loading rules; search order and k; the calibration rule; the gate; marker parsing (one table row per grammar case, including partial markers); `verifyQuote` (one case per normalisation step, offsets); the GitHub URL builder; the dictionary, as in #1; the route: the gate path makes no language-model call and sends no `data-sources`, the answer path sends `data-sources` before text, the query is exactly the latest user message, validation, 415 and 429.
- **E2E** (Playwright, mock model, production build): a suggested question shows the Sources list, a `[n]` popover opens by click and by keyboard, the badge reads verified, and the link contains `?plain=1#L`; the not-found, unknown-source and malformed scenarios show their badges; the out-of-scope question shows the refusal with `data-refusal="gate"`, and its response body has no `data-sources` part; a model refusal has `data-refusal="model"`; PT: interface and refusal; a 375 px phone: targets and no sideways scroll.
- **CI** needs no secret, as in the template.

## 11. The measured number

- **Set** [D-chat-3 for the size; D: S-13 for the language]: `measurements/questions.json`, about 40 questions, written and frozen before the first run, never overlapping the calibration set [D: R-20]. English only; Portuguese answers are checked by hand in step 4, and the README says so.
- **Runs** [D: S-19]: at most 15 questions per run, so 3 runs, each in its own rate-limit hour and apart from manual testing. #1 hit the 429 on the 20th request of an hour [F: #1 spec §9]. Any failed request or 429 aborts the run and writes an `.aborted.json`, as in #1 [F: #1 spec §14 A-16]. The headline aggregates all runs of the one frozen set into one file, with the run boundaries recorded.
- **Script:**
  - It is a Playwright project gated on `MEASURE_URL`, as in #1, run against the live demo from one stated location.
  - For each question it waits for the answer to finish and classifies it as one of: gate refusal, model refusal, answered with citations, answered without citations. Then it reads every `data-citation-verified`.
  - It counts verified attempts over all attempts in answered messages. An answer without citations is listed among the failures.
  - The interval is a seeded bootstrap over questions, 1,000 resamples, with a unit test, because citations cluster by answer [D: S-20].
  - It writes `measurements/citations-YYYY-MM-DD.json` (every question, answer, citation, status, classification, token usage and `searchMs`) and prints the README lines.
- **README:**
  - Line 1, printed by the script: "RAG with Citations — N% of citations verified verbatim (n=C citations in Q answers, 95% CI a–b)".
  - Under "How it's measured": the failures, the classification counts, the caveat of §6.3, and what "verbatim" allows.
  - A "Decisions" line explains the in-memory index with the median `searchMs` printed by the same script [D-chat-3; D: S-08].
- **Cost:** about US$ 0.03, at most about US$ 0.09 [P: arithmetic].
- **Refusal accuracy** stays supporting data under "How it's measured", never a second headline, which keeps the one-number rule [D: S-10].
- **#3** builds its own gold set; whether it reuses #2's measurement questions is decided when #3's design starts [D: R-20].

## 12. Rollout [D: R-22]

0. **Template update** (§13): its own short design, approved by Felipe, pushed with his OK.
1. **Spec, plan, execution**, with mock models only. The plan is generated from a verified throwaway prototype, as for #1. The mock-mode `index.json` is committed here (§4.2).
2. **With Felipe's OK:**
   - create `feliperrego/rag-citations` [D: R-01] and the Vercel project;
   - add the Upstash integration to Production only [D: S-21];
   - apply the environment rules: Production gets `AI_MODEL` and never `AI_MOCK`, Preview gets `AI_MOCK=1`, Development gets no Upstash [D: ROADMAP.md, lesson 4].
3. **With Felipe's OK: the real index and calibration.** Uses the linked project's Gateway credentials through `vercel env pull` (OIDC) [F: brief, gateway-provider.ts:683-703]. Costs less than US$ 0.01. The index and the frozen threshold are committed.
4. **Deploy, then production checks:**
   - one question in English and one in Portuguese;
   - the out-of-scope refusal with `data-refusal="gate"`;
   - a Portuguese answer keeps English quotes;
   - one GitHub link opens with the passage's lines selected;
   - the phone check by Felipe.
5. **With Felipe's OK:** the measurement, then the README.

Size: 2 days, by the roadmap [F: ROADMAP.md]. Felipe's real hours are recorded to calibrate later estimates, which is the roadmap's trigger [D: R-23].

## 13. Template update (step 0)

The roadmap says #1's lessons go into the template when #2 starts [F: ROADMAP.md, "Lessons to carry forward"]. The brief lists them with files and tests [F: brief §1]:

- **B1.** A 415 for non-JSON bodies, after the rate limit, as a small helper, with #1's tests ported. The wording is corrected: the 415 saves the model call, not the per-hour budget [F: brief].
- **B2.** The Upstash variable names the Marketplace injects, and "pick Upstash for Redis, not Redis". Docs, plus an optional limiter test.
- **B3.** Gateway account facts: card, paid credits, auto top-up off, and Stop does not save tokens. Docs.
- **B4.** An environment column for each variable. Docs.
- **B5.** The measurement pattern: a `measure` Playwright project gated on `MEASURE_URL`, and generic recording helpers.
- **B6.** Playwright `retries: 0` and `trace: "retain-on-failure"`.
- **B7.** The repo-creation step #1 actually used.
- **Doc corrections (rule 6):** template §10's "i18n: never" row is superseded by #1 and #2. Its "shared chat components" trigger has fired, and X-01 decides what happens.

**The template's chat-components trigger** [F: template spec §10, line 381: "Markdown rendering, shared chat components | A second chat project needs the same component; then extract it"]. #2 is that second chat project. R-08 was approved with a wrong citation: its reason quoted template §10's "3 projects" row, which is about syncing fixes into existing projects, not about moving code into the template [F: template spec §10]. Felipe decided with the correct rule in view: option (a) of X-01 [D: X-01].

## 14. Risks

| Risk | Mitigation |
|---|---|
| The model paraphrases instead of quoting, so the rate reads low | This is the honest signal the metric exists to show. The instructions ask for exact words, and the README lists the failures |
| The rate reads 100%, which looks inflated | The failures, the classification counts and the caveat of §6.3 are shown. Refusal accuracy is added as supporting data (§11) |
| Portuguese questions fall under the threshold | §8 calibrates with both languages and has a per-language rule |
| A stale index | the corpus-hash test, the chunker re-run test and the loading rules (§4.3) |
| Passage text drifting between prompt, check and screen | one passage string, `chunk.text` (§4.1) |
| The Gateway free tier might not cover embeddings | the project already has paid credits [F: ROADMAP lessons]. Whether the free tier covers embeddings is unverified [F: brief] |

## 15. Deferred decisions and their triggers

- The rows of §2's table.
- One threshold per language: §8's rule 3.
- #3's reuse of #2's questions: #3's design [D: R-20].
- The chat shell and i18n in the template: when #2 ships, before #6 starts [D: X-01].

## 16. Results

To be recorded, dated, as the rollout steps happen.

### Publish and Vercel setup (2026-09-29)

- **GitHub** [F]: the public repo `feliperrego/rag-citations` was created and `main` pushed at `fbbfa67`, with Felipe's OK. The first CI run passed, with no repository secrets.
- **Vercel project** [F: `vercel env ls`, `vercel project inspect`]: `rag-citations` runs Node 24.x in iad1.
  - `AI_MODEL` and `RATE_LIMIT_PER_HOUR` are set for Production only.
  - `AI_MOCK` is set for Preview only.
  - `ENABLE_EXPERIMENTAL_COREPACK` is set for Production and Preview.
- **Rate-limit store** [D: Felipe, 2026-09-29]. The Marketplace offered no free plan for a second Upstash database, only pay-as-you-go and fixed paid plans. Felipe chose to connect the existing free database `streaming-chat-ratelimit` from #1, for Production only and with no prefix. Its five variables are set for Production only. The two apps' keys stay apart by prefix (`streaming-chat` and `rag-citations`). #1 and #2 now share that database, so it must outlive #1.
- **AI Gateway budget** [D: Felipe, 2026-09-29]. There is one team budget of US$ 5 a month, refreshed monthly, for all projects. The template's per-project budget (U-03) is replaced by this account-wide cap. The credit balance was US$ 15.00.

### Real index and calibration (2026-09-29) [F]

- **Credentials.** `vercel env pull .env.local` wrote only `VERCEL_OIDC_TOKEN`; the file is git-ignored.
- **Index.** `EMBEDDING_MODEL=openai/text-embedding-3-small pnpm build-index`: 1536 dimensions, 101,831 tokens (about US$ 0.002), 239 chunks from 32 files, and corpus hash `8d11fa94…5ee`, the same as the mock index. `corpus/index.json` is 2,476,286 bytes.
- **Calibration.** `pnpm calibrate` embedded the 60 questions of `calibration/questions.json` (sha256 `f379fd98…d6f0`):
  - Rule 3 fired: no single threshold separates the EN and PT questions. The best single one, 0.3672, misclassifies 8.
  - No language separates on its own either, so rule 4 chose one threshold per interface language, frozen in `lib/rag/config.ts`:
    - **EN 0.4421** misclassifies 3 of 30. Two answerable questions are refused by the gate: en-in-02 "make the model pick one label from a fixed list", at 0.3683, and en-in-05 "give a tool an API key without putting it in the prompt", at 0.4244. One out-of-scope question passes to the model, which is the second layer: en-out-02 "pgvector", at 0.4668.
    - **PT 0.3427** misclassifies 3 of 30. One answerable question is refused: pt-in-02 "rótulo de uma lista fixa", at 0.2893. Two out-of-scope questions pass to the model: pt-out-02 "pgvector", at 0.3846, and pt-out-12 "next/image", at 0.3662.
  - All 8 suggested prompts land on the right side (S-28). Exit code 0.
- **Checks after freezing.** Lint, typecheck and 751 unit tests pass. A real-mode `next build` passes and lists `○ /`. The mock e2e passes 82/82.

### Deploy and production checks (2026-09-29) [F]

- **Deploy.** Pushing `a6143a3` ran the first production deploy, which is Ready at https://rag-citations-five.vercel.app. CI passed.
  - `/api/health` returns `{"ok":true,"model":"openai/gpt-6-luna","mock":false,"rateLimit":"upstash"}`.
  - The page serves `data-commit` `a6143a3`, statically, in English.
  - A `text/plain` POST gets a 415.
- **README.** The live-demo link was filled in (plan Task 16, step 2).
- **Checks in Chrome**, with Felipe's OK: five requests, four of them model calls.
  1. **"How do I embed many values in parallel?"** (EN). The answer carries 2 citations, `[5]` and `[1]`, both `data-citation-verified="true"`. The Sources list shows "1 of 1 quotes verified" for each. The answer also contains a fenced code block, against rule 4 of §6.1. It renders as plain text. (Corrected on 2026-09-29, after the measurement: S-14's trigger counts code-like text outside backticks, so a fenced block does not count toward it. The first version of this line said it did.)
  2. **"Como gerar embeddings de vários textos em paralelo?"** (PT interface, `lang=pt-BR`). The answer is in Portuguese with English quotes (R-12). It carries 2 citations to `[1]`, one verified and one not found. The unverified quote dropped the Markdown link syntax the passage has: the passage has `` [`embedMany`](/docs/reference/ai-sdk-core/embed-many) ``, and the quote has only `` `embedMany` ``. Under S-11, Markdown syntax is compared as it is, so this counts as not found. The model also wrote a code block here.
  3. **"View source on GitHub"** opens `30-embeddings.mdx?plain=1#L27-L50` in GitHub's code view, with lines 27–50 selected.
  4. **"How do I enable dark mode in Tailwind CSS?"** (EN). The fixed English refusal, with `data-refusal="gate"`, no Sources list and no citations.
  5. **"How do I store embeddings in Postgres with pgvector?"**, the calibration case that passes the EN gate (0.4668 ≥ 0.4421). The model gave the exact refusal sentence, with `data-refusal="model"` and no citations.
- **Two findings for Felipe, before the measurement:**
  - (a) The model writes fenced code blocks, in 2 of 2 answers, despite the instructions. S-14's trigger will likely fire. Felipe's answer (2026-09-29, "pode seguir"): keep S-14 as it is and decide after the measurement, when `pnpm count-code-answers` gives the count [D]. Outcome: the trigger did not fire (Measurement, below).
  - (b) The model drops Markdown link syntax inside quotes, which S-11 counts against the rate. Felipe's answer (2026-09-29, option "B"): allow it, as A-14 in §18 [D].
- **A-14 in production** [F: CI, `vercel inspect`, `/api/health`]. Pushing `24b967e` with Felipe's OK redeployed production. CI passed, the deploy is Ready, the page serves `data-commit` `24b967e`, and `/api/health` reports the real model and Upstash.
- **Phone check** [D: Felipe, 2026-09-29]. Felipe checked the live demo on his phone after the A-14 deploy: "Phone check ok". That closes step 4.
- **Measurement, run 1** [F: `measurements/citations-run-1-2026-09-29.json`], from "Fortaleza, home fibre" at 18:00 UTC on `24b967e`: 15 questions, 19 of 21 citations verified. Two findings, and Felipe's answers (2026-09-29, "D1 a, D2 a") [D]:
  - **D1.** 5 of the 15 in-scope questions were refused: 4 by the gate (for example "How can I smooth out a choppy text stream?", top score 0.41 against the English threshold 0.442) and 1 by the model. The measurement questions paraphrase the docs more than the calibration set did [P: inference]. The headline counts citations, so refusals do not lower it; they shrink n and widen the interval, and the README prints the in-scope refusals. Answer: (a) keep the frozen threshold and publish. Improving the gate is a candidate for #3's "one improvement" (ROADMAP). Trigger: when #3 starts.
  - **D2.** In m07 the model escaped the inner quotes inside its marker, `` [1: "You can add `.describe(\"...\")`…"] ``, though its own text writes `.describe("...")`. It counts as not found. The other failure, m13, is a real one: the model dropped a comma from the code it quoted. Answer: (a) keep the rule for this measurement. Changing it after seeing measurement data would choose the rule by its result; A-14 came from a production check, before the measurement. A-15 (accept `\"` as `"`) is a candidate for #3. Trigger: when #3 starts.
- **Measurement** [F: `measurements/citations-2026-09-29.json`, printed by `pnpm aggregate-citations`]. Three runs on 2026-09-29, at 18:00, 20:00 and 22:00 UTC, all on `24b967e` with `openai/gpt-6-luna` from "Fortaleza, home fibre". After run 2 Felipe canceled run 3, then asked for it again at 18h local; the quota guard allowed 22:00 UTC (19h local) at the earliest, so it ran then [D: Felipe, 2026-09-29].
  - Headline: "RAG with Citations — 85% of citations verified verbatim (n=71 citations in 32 answers, 95% CI 74–94%)". The README lines are the ones the script printed.
  - All 5 out-of-scope questions were refused by the gate. In-scope refused: 8 of 40, 5 by the gate and 3 by the model (D1).
  - The 11 unverified citations are all `not-found`. By script over their quotes: 4 carry a backslash escape the model wrote inside the marker, `\"` in m07 and `\n` three times in m34 (the D2 class); 2 have fewer than 3 words (m30, m31). The other 5, by my reading [P]: the model edited or joined the text. m13 dropped a comma, m17 a `//`, m31 joined two list items, m36 two table rows, and m33 dropped a link's backticks along with its syntax, which A-14 keeps.
  - S-14: `pnpm count-code-answers` counts 0 of 32 answers with code-like text outside backticks, so the trigger did not fire, and none of the 32 answers has a fenced block [F: script]. Answers stay plain text [D: R-10]. The fenced blocks of the production checks came from 2 answers outside the measurement.
  - For #3: the escape class covers `\n` as well as `\"`, 4 of the 11 unverified citations. The ROADMAP candidate says so.

## 17. Proposals and answers

All items below were approved on 2026-09-28 ("todas ok"); X-01 took option (a).

**Closest to Felipe's own judgement**, because visitors read them or they touch a recorded rule:

| ID | Proposal | Section |
|---|---|---|
| X-01 | Template §10's chat-components trigger has fired. (a) **Recommended:** copy #1's chat shell into #2 now (R-07), and extract the shared shell and i18n into the template **when #2 ships, before the next chat project (#6) starts**, using #1 and #2 as the two references. Extracting now would generalise from #1 alone. (b) Extract into the template now, in step 0, from #1 only | 2, 13 |
| S-01 | The wording of the system instructions | 6.1 |
| S-02 | The four suggested questions, in EN and PT | 7.1 |
| S-03 | The new interface strings, in EN and PT | 7.1 |
| S-04 | The success criteria as written | 1 |
| S-09 | The gate refuses in the interface language; the model refuses in the question's language | 8 |
| S-10 | Refusal accuracy is supporting data, never a second headline | 11 |
| S-11 | "Verbatim" allows whitespace, quote style, Unicode form and letter case, and the README says so (A-14 later added link syntax) | 6.3 |
| S-12 | Malformed citations and unfinished markers count as unverified, in the denominator; answers without citations are listed as failures | 6.2, 6.3, 11 |
| S-13 | The measurement set is English only; Portuguese is checked by hand, and the README says so | 11 |
| S-20 | The interval is a seeded bootstrap over questions, not Wilson over citations | 11 |
| S-21 | Upstash on Production only | 12 |

**Engineering details**, where my proposals err less:

| ID | Proposal | Section |
|---|---|---|
| S-06 | The calibration rule's details: midpoint of the gap, the no-separation fallback, 15+15 per language | 8 |
| S-07 | Mock and real build modes of `index.json`, and the loading rules | 4.2, 4.3 |
| S-08 | `searchMs` in the message metadata, printed by the measurement script for the README's "Decisions" line | 4.4, 11 |
| S-14 | The code-block trigger counted by script over the measurement file | 2 |
| S-15 | No reranker in #2; #3's design decides | 2 |
| S-16 | The Sources list shows only cited passages, with per-quote results | 7 |
| S-17 | The client sends only the latest user message; no 20-message cap | 5 |
| S-18 | `EMBEDDING_MODEL` for the build; the route embeds with the index's own model | 4.2 |
| S-19 | 15 questions per run, 3 runs, abort on failure, one aggregated file | 11 |
| S-22 | One passage string: the raw lines, frontmatter excluded | 4.1 |
| S-23 | The marker grammar, curly delimiters accepted | 6.2 |
| S-24 | How refusals are marked (`data-refusal`), and the Sources list hidden on refusal | 5, 7 |
| S-25 | `MAX_SECTION_WORDS = 1500` and the chunker re-run test | 4.1, 4.3 |
| S-26 | The corpus stored unmodified, plus the full Apache-2.0 text | 3 |
| S-27 | The mocks: word-hash embedder, magic-token scenarios, the pinned mock threshold | 8, 10 |
| S-28 | Suggested prompts checked against the frozen threshold; a prompt on the wrong side is reworded, never the threshold | 8 |


## 18. Amendments from the prototype (2026-09-29)

Before the plan was written, a throwaway prototype of this spec was built, reviewed by five independent reviewers each followed by a skeptic, fixed, and verified. At every task end: lint, typecheck, unit and e2e. At the tip: 746 unit tests; 82 e2e tests green three times in CI mode; a stress run of 328/328. The plan `docs/plans/2026-09-29-rag-citations.md` is generated from it. The prototype settled some points that the text above leaves open, and it raised items for Felipe.

**Facts that refine the text above** `[F: prototype]`:

- **A-01 (§4.1).** The pinned corpus gives 239 chunks from 32 files. The mock-mode `index.json` is 513,593 bytes and differs from one build to the next only in `builtAt`.
- **A-02 (§6.3).** `verifyQuote(quote, passage)` returns `verified` or `not-found`, with offsets. A second function, `verifyCitation`, adds `unknown-source` and `malformed`, because the first function has no `n` and no attempt type.
- **A-03 (§5).** Embedding, search and the gate run inside `createUIMessageStream`'s `execute`, right after `start`. The order on the wire is still the one §5 gives.
- **A-04 (§11).** The route sends the answer's token usage on its finish chunk, so the measurement file can record it.
- **A-05 (§7.1).** `composer.capPlaceholder` is not in the dictionary: its only use was #1's 20-message cap, which S-17 removes.
- **A-06 (plan).** The dictionary and the locale modules land in their own task (Task 5), before any task that needs a string. No task keeps a temporary copy.

**Proposals from the prototype**, approved by Felipe on 2026-09-29 ("todas ok") and cited as `[D: A-xx]`:

| ID | Proposal | Section |
|---|---|---|
| A-07 | **S-10 made measurable.** The measurement set has 40 in-scope English questions plus 5 near-miss out-of-scope ones: LlamaIndex PDFs, a Qdrant collection, RAGAS faithfulness, Stable Diffusion with ONNX, and GraphQL with Apollo. That makes 45, in 3 runs of 15. Refusal accuracy is printed as supporting data, "r of k out-of-scope refused (gate g, model m); in-scope refused: x of n". A correct refusal is not a failure | 11 |
| A-08 | **Rounding of the headline.** The rate and both interval bounds are whole percents, where a share below 100% never prints 100 and a share above 0 never prints 0. For example, 249/250 prints 99%. The alternative is plain rounding | 11 |
| A-09 | **README line format.** "Q answers" counts the answers with at least one citation attempt, the set the bootstrap resamples. The interval prints as "95% CI 89–98%" | 11 |
| A-10 | **Calibration rule 4.** "The lowest t on ties" has no literal minimum, because tied thresholds form intervals open at the bottom. The rule uses the midpoint of the lowest gap with the fewest errors, the same point rule 2 picks | 8 |
| A-11 | **A Portuguese answer in the e2e.** The mock answers in English, so the e2e cannot check that a Portuguese question gets a Portuguese answer. That stays with rule 3 of §6.1 (pinned by the prompt unit test) and the production check of §12 step 4. The alternative is a mock scenario that answers in Portuguese | 10, 12 |
| A-12 | **Page description** (metadata): "Answers questions from the AI SDK Core docs, citing each passage and checking every quote against it, by Felipe Rêgo." | 7 |

**From the final review of the implementation (2026-09-29)**, approved by Felipe on 2026-09-29 ("1-13 aprovada") and cited as `[D: A-13]`:

| ID | Proposal | Section |
|---|---|---|
| A-13 | **Whole words only.** A quote verifies only when it starts and ends at word edges in the passage. For example, "mbed many values in" no longer verifies against "embed many values in one call". S-11 allows whitespace, quote style, Unicode form and letter case, and nothing else, so a quote cut inside a word is not verbatim. This makes the check stricter; it can only lower the rate | 6.3 |

**From the production checks of §16 (2026-09-29)**, Felipe's choice between (a) keeping S-11 as it is and (b) allowing link syntax: "B" (2026-09-29), cited as `[D: A-14]`. Its details (link text that wraps a line, the mark over a cut link, a quote with half a link not verifying) were confirmed the same day ("todas ok"):

| ID | Decision | Section |
|---|---|---|
| A-14 | **Markdown links reduced to their text.** Before comparing, each inline link `[text](url)`, with an optional title, becomes `text`, in the quote and in the passage. The link text may wrap onto the next line, but not across a blank line. A quote that keeps the link syntax still verifies. The `<mark>` covers the original text: the whole link when the quote starts or ends at the link's text, and the cut link's `[` or `](url)` when the quote starts or ends inside it. Other Markdown and MDX syntax is still compared as it is. Why: in production check 2 the model quoted `` [`embedMany`](/docs/…) `` as `` `embedMany` ``, words a reader sees in the passage, and S-11 counted that as not found. This makes the check looser; it can only raise the rate, and the README and the printed caveat say so. The mock quotes and the corpus test copy words with links reduced | 6.3, 11 |

## Appendix A. Approved proposals (2026-09-28, "todas ok")

**Section 1, architecture and flow:**
- R-01: Repo `feliperrego/rag-citations`, created from the updated template.
- R-02: Pin the docs to tag `ai@7.0.114`, the same SDK version the app uses; check that the tag exists; keep `corpus/SOURCES.md` with URL, commit and a copy of the license.
- R-03: One chunk per `##` section, code blocks whole; comparing other chunking strategies is left to #4.
- R-04: k = 5 passages per question.
- R-05: The answer model is #1's (`openai/gpt-6-luna`, 1024-token cap).
- R-06: Each question is retrieved on its own, and the model sees only the current question plus the passages, no history; follow-ups do not work. Trigger for query rewriting: the limitation shows up in real use.
- R-07: Reuse #1's chat shell (composer, Stop, Regenerate, scroll, banners, EN/PT switch), without the time-to-first-token caption.
- R-08: The template update comes first, with its own short design. Embeddings and i18n stay in #2 until a third project needs them. (Its reason cited the wrong template rule; see §13 and X-01.)

**Section 2, citations, verification and screen:**
- R-09: Inline citation `[n: "literal phrase"]`, read from the accumulated text; an incomplete marker stays hidden until it closes.
- R-10: Plain-text answers, as in #1; API names in backticks become `<code>` through a minimal renderer, with no Markdown library and no code blocks.
- R-11: The quoted phrase has 3 to 25 words; an `[n]` out of range counts as not verified.
- R-12: The quoted phrase stays in the source's language (English), even in a Portuguese answer.
- R-13: An `[n]` button with a popover, plus an always-visible Sources list, and a link to the exact lines on GitHub at the pinned version.
- R-14: The badge and `data-citation-verified` come from the same function the measurement uses.
- R-15: Suggested questions: 3 the docs answer plus 1 out of scope; the EN and PT wording goes in the spec for review.
- R-16: No "about Felipe" prompts from #1.

**Section 3, "I don't know", languages, tests, measurement and delivery order:**
- R-17: The fixed refusal text. EN: "I don't know. The AI SDK Core docs I search don't cover that." PT: "Não sei. A documentação do AI SDK Core que eu consulto não cobre isso."
- R-18: A single threshold chosen with EN and PT questions together. Rule fixed before seeing the numbers: if no single threshold separates both languages, one threshold per interface language.
- R-19: In mock mode the index is recomputed in memory with the mock embedder, from the text inside `index.json`; no extra file; a mock threshold of its own.
- R-20: #2 has its own sets (calibration and measurement); #3 builds its gold set and decides later whether to reuse anything.
- R-21: The EN/PT interface strings follow #1's pattern and go in the spec for review.
- R-22: Delivery order: 0 template update (own short design); 1 spec → plan from a prototype → execution with mocks; 2 with OK: repo, Vercel project, Upstash integration as in #1; 3 with OK: real index and calibration (< US$ 0.01, Gateway credentials through `vercel env pull`); 4 deploy and production checks; 5 with OK: measurement and README.
- R-23: Size 2 days, as in the roadmap; record the real hours to calibrate later estimates.
