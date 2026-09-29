import { beforeEach, describe, expect, it } from "vitest";
import { countWords } from "@/lib/rag/chunk";
import { parseAnswer, type CitationAttempt } from "@/lib/rag/citations";
import { readIndexFile } from "@/lib/rag/index-file";
import { REFUSAL_SENTENCES, isRefusalText } from "@/lib/rag/refusal";
import { normalise, verifyCitation, verifyQuote } from "@/lib/rag/verify";
import {
  MOCK_SCENARIO_TRIGGERS,
  NOT_FOUND_QUOTE,
  instructionsText,
  lastUserText,
  mockAnswer,
  mockQuote,
  resetMockScenarios,
  selectScenario,
  type MockPrompt,
} from "./mock-scenarios";

const PASSAGES = readIndexFile().chunks.map((chunk) => chunk.text);

function userPrompt(...texts: string[]): MockPrompt {
  return texts.map((text) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text }],
  }));
}

/** Each citation attempt of a finished answer, with its status against the passages. */
function statuses(answer: string, passages: readonly string[]) {
  return parseAnswer(answer, { streaming: false })
    .filter(
      (segment): segment is CitationAttempt => segment.type !== "text" && segment.type !== "code",
    )
    .map((attempt) => ({
      n: attempt.type === "citation" ? attempt.n : null,
      status: verifyCitation(attempt, passages).status,
    }));
}

describe("MOCK_SCENARIO_TRIGGERS", () => {
  it("lists one magic token per chat-mock scenario (spec §10, S-27)", () => {
    expect(MOCK_SCENARIO_TRIGGERS).toEqual([
      "[[notfound]]",
      "[[unknown]]",
      "[[malformed]]",
      "[[refuse]]",
      "[[slow]]",
      "[[error]]",
    ]);
  });
});

describe("lastUserText", () => {
  it("reads the text parts of the last user message only", () => {
    const prompt: MockPrompt = [
      { role: "system", content: "[[error]] in the instructions" },
      { role: "user", content: [{ type: "text", text: "[[slow]] earlier" }] },
      { role: "assistant", content: [{ type: "text", text: "[[error]] in an answer" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "last " },
          { type: "text", text: "message" },
        ],
      },
    ];
    expect(lastUserText(prompt)).toBe("last message");
  });

  it('returns "" when there is no user message', () => {
    expect(lastUserText([{ role: "system", content: "x" }])).toBe("");
  });
});

describe("instructionsText", () => {
  it("joins the system messages with a blank line", () => {
    const prompt: MockPrompt = [
      { role: "system", content: "first" },
      ...userPrompt("question"),
      { role: "system", content: "second" },
    ];
    expect(instructionsText(prompt)).toBe("first\n\nsecond");
  });

  it('returns "" without system messages', () => {
    expect(instructionsText(userPrompt("question"))).toBe("");
  });
});

// The Set of seen [[error]] prompts is module state, so every test starts from a clean one.
describe("selectScenario", () => {
  beforeEach(() => {
    resetMockScenarios();
  });

  it.each([
    ["How do I rerank search results?", "default"],
    ["How do I rerank search results? [[notfound]]", "not-found"],
    ["How do I rerank search results? [[unknown]]", "unknown-source"],
    ["How do I rerank search results? [[malformed]]", "malformed"],
    ["How do I rerank search results? [[refuse]]", "refuse"],
    ["How do I rerank search results? [[slow]]", "slow"],
    ["How do I rerank search results? [[error]]", "error"],
  ])("picks the scenario of %j", (question, scenario) => {
    expect(selectScenario(userPrompt(question))).toBe(scenario);
  });

  it("picks error only the first time it sees the exact question", () => {
    expect(selectScenario(userPrompt("[[error]] once"))).toBe("error");
    expect(selectScenario(userPrompt("[[error]] once"))).toBe("default");
    expect(selectScenario(userPrompt("[[error]] once again"))).toBe("error");
  });

  it("lets [[error]] win, then falls back to the next trigger in list order", () => {
    expect(selectScenario(userPrompt("[[slow]] [[refuse]] [[error]]"))).toBe("error");
    expect(selectScenario(userPrompt("[[slow]] [[refuse]] [[error]]"))).toBe("refuse");
  });

  it("looks only at the last user message", () => {
    expect(selectScenario(userPrompt("[[error]] earlier", "[[slow]] now"))).toBe("slow");
    expect(selectScenario(userPrompt("[[slow]] earlier", "plain now"))).toBe("default");
  });
});

describe("mockQuote", () => {
  it("takes up to 12 words of the first prose line, outside code fences", () => {
    const passage = [
      "## Settings",
      "",
      "<Note>",
      "- A list item with enough words",
      "| A | table | row |",
      "Too short",
      "```ts",
      "const result = await embedMany({ values });",
      "```",
      "You can set the maximum number of parallel requests with the maxParallelCalls option,",
      "which defaults to Infinity.",
    ].join("\n");
    expect(mockQuote(passage)).toBe(
      "You can set the maximum number of parallel requests with the maxParallelCalls",
    );
  });

  it("falls back to the first 12 words when no line is prose", () => {
    expect(mockQuote("## Heading\n\n```ts\nconst a = 1;\n```")).toBe(
      "## Heading ```ts const a = 1; ```",
    );
  });

  it("returns null for a passage of fewer than 3 words", () => {
    expect(mockQuote("## Settings\n")).toBeNull();
    expect(mockQuote("\n")).toBeNull();
  });

  // So every default answer the mock streams is verified, whatever passages it gets.
  it("gives a quote that verifies against its passage, for every committed chunk", () => {
    for (const passage of PASSAGES) {
      const quote = mockQuote(passage);
      if (countWords(passage) < 3) {
        expect(quote, passage).toBeNull();
      } else {
        expect(verifyQuote(quote ?? "", passage).status, passage).toBe("verified");
      }
    }
  });
});

describe("mockAnswer", () => {
  const passages = PASSAGES.slice(0, 5);

  it("cites the first two passages with verified quotes and names an API in backticks", () => {
    const answer = mockAnswer("default", passages);
    expect(statuses(answer, passages)).toEqual([
      { n: 1, status: "verified" },
      { n: 2, status: "verified" },
    ]);
    expect(parseAnswer(answer, { streaming: false })).toContainEqual({
      type: "code",
      text: "streamText",
    });
  });

  it("verifies the default answer's citations for every group of five committed chunks", () => {
    for (let i = 0; i < PASSAGES.length; i += 5) {
      const group = PASSAGES.slice(i, i + 5);
      for (const { status } of statuses(mockAnswer("default", group), group)) {
        expect(status).toBe("verified");
      }
    }
  });

  it.each([
    ["not-found", { n: 1, status: "not-found" }],
    ["unknown-source", { n: 6, status: "unknown-source" }],
    ["malformed", { n: null, status: "malformed" }],
  ] as const)("adds one %s citation after the default answer's", (scenario, attempt) => {
    expect(statuses(mockAnswer(scenario, passages), passages)).toEqual([
      { n: 1, status: "verified" },
      { n: 2, status: "verified" },
      attempt,
    ]);
  });

  it("[[refuse]] answers with the English refusal sentence alone", () => {
    const answer = mockAnswer("refuse", passages);
    expect(answer).toBe(REFUSAL_SENTENCES.en);
    expect(isRefusalText(answer)).toBe(true);
  });

  it("skips a passage it cannot quote, keeping the passages' numbers", () => {
    const withHeading = ["## Settings\n", ...passages.slice(0, 2)];
    expect(statuses(mockAnswer("not-found", withHeading), withHeading)).toEqual([
      { n: 2, status: "verified" },
      { n: 3, status: "verified" },
      { n: 2, status: "not-found" },
    ]);
  });

  it("cites only the passages it received", () => {
    expect(statuses(mockAnswer("default", passages.slice(0, 1)), passages)).toEqual([
      { n: 1, status: "verified" },
    ]);
    expect(statuses(mockAnswer("default", []), passages)).toEqual([]);
  });
});

describe("NOT_FOUND_QUOTE", () => {
  it("has 3 to 25 words and is in no committed chunk, so only its absence fails it", () => {
    expect(NOT_FOUND_QUOTE.split(" ").length).toBeGreaterThanOrEqual(3);
    for (const passage of PASSAGES) {
      expect(normalise(passage)).not.toContain(normalise(NOT_FOUND_QUOTE));
    }
  });
});
