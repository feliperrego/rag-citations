import { embed, type EmbeddingModel, embedMany } from "ai";
import { K, MOCK_REFUSAL_THRESHOLD, type RefusalThreshold } from "./config";
import { getEmbeddingModel } from "./embedder";
import { checkQueryDimensions, type LoadedIndex } from "./index-file";
import { createInMemoryVectorStore, type SearchResult, type VectorStore } from "./vector-store";

/** One question's passages (spec §5 steps 4–5). */
export type Retrieval = {
  /** The top K passages, best first. */
  results: SearchResult[];
  /** The best score, which the gate compares with the threshold (spec §8). */
  topScore: number;
  /** The in-memory search alone, in milliseconds, for the message metadata (S-08). */
  searchMs: number;
};

export type Retriever = {
  /** The gate's threshold: the calibrated one in real mode, the pinned mock one in mock mode. */
  threshold: RefusalThreshold;
  retrieve(question: string, options?: { abortSignal?: AbortSignal }): Promise<Retrieval>;
};

/**
 * Real mode searches the stored vectors. Mock mode embeds every chunk's text with the mock
 * embedder at the first question, in memory (spec §4.3, R-19): concurrent first questions share
 * the build, and a failed build is retried at the next question.
 */
function storeLoader(index: LoadedIndex, model: EmbeddingModel): () => Promise<VectorStore> {
  if (!index.mock) {
    const store = Promise.resolve(createInMemoryVectorStore(index.entries));
    return () => store;
  }
  const { chunks } = index;
  let store: Promise<VectorStore> | undefined;
  return () => {
    store ??= embedMany({ model, values: chunks.map(({ text }) => text) }).then(
      ({ embeddings }) =>
        createInMemoryVectorStore(chunks.map((chunk, i) => ({ chunk, vector: embeddings[i] }))),
      (error: unknown) => {
        store = undefined;
        throw error;
      },
    );
    return store;
  };
}

/**
 * Embeds a question and searches the index for its top K passages (spec §4.4). Build it from
 * loadIndex(), which has already applied the loading rules (spec §4.3).
 */
export function createRetriever(index: LoadedIndex): Retriever {
  const model = getEmbeddingModel(index);
  const getStore = storeLoader(index, model);
  const dimensions = index.mock ? null : index.dimensions;

  return {
    threshold: index.mock ? MOCK_REFUSAL_THRESHOLD : index.threshold,

    async retrieve(question, { abortSignal } = {}) {
      const store = await getStore();
      const { embedding } = await embed({ model, value: question, abortSignal });
      if (dimensions !== null) checkQueryDimensions(embedding, dimensions);

      const start = performance.now();
      const results = await store.search(embedding, K);
      const searchMs = performance.now() - start;

      if (results.length === 0) throw new Error("The index has no passages");
      return { results, topScore: results[0].score, searchMs };
    },
  };
}
