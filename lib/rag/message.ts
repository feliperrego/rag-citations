import type { UIMessage } from "ai";
import { sourceUrl } from "./github";
import type { SearchResult } from "./vector-store";

/** One retrieved passage, as the data-sources part carries it (spec §5 step 7). */
export type Source = {
  /** The n that [n: "quote"] cites: the passage's rank, from 1. */
  number: number;
  file: string;
  heading: string;
  startLine: number;
  endLine: number;
  /** chunk.text, the one passage string the model saw and verifyQuote checks (S-22). */
  text: string;
  /** The passage's lines on GitHub at the pinned commit (R-13). */
  url: string;
  /** Cosine similarity to the question. */
  score: number;
};

/** The assistant message's metadata (spec §5 steps 6–7, S-08, S-24). */
export type RagMetadata = {
  /** Present only when the gate refused. */
  refusal?: "gate";
  topScore: number;
  /** The threshold the gate applied, under the interface language. */
  threshold: number;
  /** The in-memory search alone, in milliseconds. */
  searchMs: number;
};

export type RagDataTypes = { sources: Source[] };

/** The chat's message type, for the route's stream and useChat on the client. */
export type RagUIMessage = UIMessage<RagMetadata, RagDataTypes>;

/** The data-sources entries for the retrieved passages, numbered from 1 in rank order. */
export function toSources(results: readonly SearchResult[]): Source[] {
  return results.map(({ chunk, score }, i) => ({
    number: i + 1,
    file: chunk.file,
    heading: chunk.heading,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    text: chunk.text,
    url: sourceUrl(chunk),
    score,
  }));
}
