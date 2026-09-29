import { describe, expect, it } from "vitest";
import { MOCK_SCENARIO_TRIGGERS } from "./mock-scenarios";

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
