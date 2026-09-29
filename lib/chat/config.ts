/**
 * Chat limits shared by the client and the server, as in #1 (R-07).
 * Keep this module free of server-only imports: client components import it.
 */

/** Longest question, in characters (#1 D-S-03). The composer's maxLength matches it. */
export const MAX_USER_CHARS = 2000;

/** Output cap of the answer's streamText call (spec §5 step 8, R-05). */
export const MAX_OUTPUT_TOKENS = 1024;

/** streamText timeout until the first content chunk (#1 D-S-04). */
export const FIRST_CHUNK_TIMEOUT_MS = 20_000;

/** streamText timeout between content chunks (#1 D-S-04). */
export const CHUNK_TIMEOUT_MS = 15_000;
