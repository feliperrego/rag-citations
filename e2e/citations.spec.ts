import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  MALFORMED_TRIGGER,
  NOT_FOUND_QUOTE,
  NOT_FOUND_TRIGGER,
  REFUSE_TRIGGER,
  SLOW_TRIGGER,
  UNKNOWN_SOURCE_TRIGGER,
} from "@/lib/ai/mock-scenarios";
import { FIRST_CHUNK_TIMEOUT_MS } from "@/lib/chat/config";
import { SAFE_ERROR_MESSAGE } from "@/lib/chat/errors";
import { parseAnswer, parseCodeSpans } from "@/lib/rag/citations";
import type { Source } from "@/lib/rag/message";
import { normalise } from "@/lib/rag/verify";
import { parseSse, type SseChunk, textDeltas } from "@/tests/helpers/sse";
import { captureChatReply } from "./helpers/chat-reply";

// E2E for the citation interface (spec §7, §10): the production build in mock mode (AI_MOCK=1),
// zero cost. The mock model copies its quotes from the passages the route sent, so the page runs
// the real parsing and verification (spec §6). Each test reads the passages and the answer from
// the response itself; the interface strings are literals, as in chat.spec.ts.

// The suggested questions (spec §7.1).
const PROMPTS = [
  "How do I embed many values in parallel?",
  "How can I test my code without calling a real model?",
  "How do I rerank search results?",
  "How do I enable dark mode in Tailwind CSS?",
] as const;
// An in-scope question for the scenario triggers (tests/mock-threshold.test.ts pins its score).
const QUESTION = PROMPTS[2];
const REFUSAL_EN = "I don't know. The AI SDK Core docs I search don't cover that.";
const GENERIC_ERROR_TEXT = "Couldn't get a response. Check your connection and try again.";

/** What the route streamed for one question. */
type Exchange = { raw: string; sources: Source[]; answer: string };

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const sendButton = (page: Page) => page.getByRole("button", { name: "Send message" });
const promptButton = (page: Page, index: number) =>
  page.getByRole("button", { name: PROMPTS[index], exact: true });
const assistantBubbles = (page: Page) => page.locator('[data-message-role="assistant"]');
const userBubbles = (page: Page) => page.locator('[data-message-role="user"]');
// The error banner, located by its data-slot as in chat.spec.ts.
const banner = (page: Page) => page.locator('[data-slot="alert"]');
const retryButton = (page: Page) => page.getByRole("button", { name: "Retry", exact: true });
// The answer text is the first child of an assistant bubble, as in chat.spec.ts.
const answerText = (bubble: Locator) => bubble.locator(":scope > div").first();
// One per citation attempt, on the inline buttons only (spec §6.3).
const attempts = (bubble: Locator) => bubble.locator("[data-citation-verified]");
const sourceButton = (scope: Page | Locator, n: number) =>
  scope.getByRole("button", { name: `Source ${n}`, exact: true });
const sourcesList = (bubble: Locator) => bubble.getByRole("region", { name: "Sources" });
const popover = (page: Page) => page.getByRole("dialog");

/** A UI message stream body: one SSE frame per chunk, then [DONE], as the route writes it. */
function sseBody(chunks: readonly object[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

/** The data-sources part of a UI message stream, or [] when there is none. */
function sourcesOf(chunks: readonly SseChunk[]): Source[] {
  return (chunks.find((chunk) => chunk.type === "data-sources")?.data ?? []) as Source[];
}

/** Runs `send` and returns what the route sent, once the page has finished the answer. */
async function ask(page: Page, send: () => Promise<void>): Promise<Exchange> {
  const { body: raw } = await captureChatReply(page, send);
  // The page has been busy since the send, so Send is back once it has read the last chunk.
  await expect(sendButton(page)).toBeVisible({ timeout: 20_000 });
  const sse = parseSse(raw);
  return { raw, sources: sourcesOf(sse.chunks), answer: textDeltas(sse).join("") };
}

function askText(page: Page, text: string): Promise<Exchange> {
  return ask(page, async () => {
    await composer(page).fill(text);
    await sendButton(page).click();
  });
}

/** A heading as the page shows it: code spans without their backticks (R-10). */
function shownHeading(heading: string): string {
  return parseCodeSpans(heading)
    .map((segment) => segment.text)
    .join("");
}

/** The well-formed markers of a finished answer, in order. */
function markers(answer: string): { n: number; quote: string }[] {
  return parseAnswer(answer, { streaming: false }).flatMap((segment) =>
    segment.type === "citation" ? [segment] : [],
  );
}

async function height(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.height ?? 0;
}

test("a suggested question shows [n] buttons, code, and the Sources list of the cited passages", async ({
  page,
}) => {
  await page.goto("/");
  const { sources, answer } = await ask(page, () => promptButton(page, 0).click());
  const bubble = assistantBubbles(page);
  // The mock cites the first two passages it can quote; the other three are not listed (S-16).
  expect(sources).toHaveLength(5);
  expect(markers(answer).map(({ n }) => n)).toEqual([1, 2]);

  // One button per marker, named by its source, whose quote verified (spec §7, R-14).
  await expect(attempts(bubble)).toHaveCount(2);
  for (const n of [1, 2]) {
    await expect(sourceButton(bubble, n)).toHaveText(`[${n}]`);
    await expect(sourceButton(bubble, n)).toHaveAttribute("data-citation-verified", "true");
  }
  // Plain text between them: backticks become <code>, and no marker text is left (R-10).
  await expect(answerText(bubble).locator("code")).toHaveText(["streamText"]);
  await expect(answerText(bubble)).not.toContainText("`");
  await expect(answerText(bubble)).not.toContainText('"');

  // Sources: the cited passages in order of first citation, each with its quotes' result.
  const list = sourcesList(bubble);
  await expect(list.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(2);
  for (const [i, source] of sources.slice(0, 2).entries()) {
    await expect(items.nth(i)).toContainText(`[${source.number}]`);
    await expect(items.nth(i)).toContainText(source.file);
    await expect(items.nth(i)).toContainText("1 of 1 quotes verified");
    await expect(
      items.nth(i).getByRole("link", { name: shownHeading(source.heading), exact: true }),
    ).toHaveAttribute("href", source.url);
  }
  await expect(bubble).not.toHaveAttribute("data-refusal");
});

test("[n] opens a popover by click: heading, file, the quote marked in its passage, the badge and the GitHub link", async ({
  page,
}) => {
  await page.goto("/");
  const { sources, answer } = await ask(page, () => promptButton(page, 0).click());
  const [first] = markers(answer);
  const source = sources[first.n - 1];

  await sourceButton(page, first.n).click();
  const dialog = popover(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(shownHeading(source.heading));
  await expect(dialog).toContainText(source.file);
  await expect(dialog.getByText("Quote verified", { exact: true })).toBeVisible();

  // The passage is the one passage string, as it is (S-22), with the quote in <mark>.
  const mark = dialog.locator("mark");
  await expect(mark).toHaveCount(1);
  expect(normalise(await mark.innerText())).toBe(normalise(first.quote));
  expect(await mark.evaluate((element) => element.parentElement?.textContent)).toBe(source.text);

  const link = dialog.getByRole("link", { name: "View source on GitHub", exact: true });
  await expect(link).toHaveAttribute("href", source.url);
  await expect(link).toHaveAttribute("href", /\?plain=1#L\d+-L\d+$/);
  await expect(link).toHaveAttribute("target", "_blank");

  // A click outside closes it; nothing depends on hover.
  await page.locator("header").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
});

test("a [n] popover opens and closes by keyboard, and focus returns to its button", async ({
  page,
}) => {
  await page.goto("/");
  await ask(page, () => promptButton(page, 0).click());
  const button = sourceButton(page, 2);
  const dialog = popover(page);

  await button.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("Quote verified", { exact: true })).toBeVisible();
  // Focus moves into the popover: first the passage, which scrolls, then the GitHub link.
  await expect(dialog.locator("mark").locator("xpath=..")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("link", { name: "View source on GitHub" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("the popover scrolls its passage to the marked quote", async ({ page }) => {
  await page.goto("/");
  // The real passages, and an answer that quotes the last words of the longest one.
  let quote = "";
  await page.route("**/api/chat", async (route) => {
    const sse = parseSse((await (await route.fetch()).body()).toString("utf8"));
    const sources = sourcesOf(sse.chunks);
    const longest = sources.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    quote = longest.text.trim().split(/\s+/).slice(-8).join(" ");
    const text = `The end of a long passage [${longest.number}: "${quote}"].`;
    const body = [
      ...sse.chunks.filter((chunk) =>
        ["start", "message-metadata", "data-sources"].includes(chunk.type),
      ),
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: text },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: "stop" },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("");
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      body: `${body}data: [DONE]\n\n`,
    });
  });
  await composer(page).fill(QUESTION);
  await sendButton(page).click();

  const citation = attempts(assistantBubbles(page));
  await expect(citation).toHaveAttribute("data-citation-verified", "true", { timeout: 20_000 });
  await citation.click();
  const mark = popover(page).locator("mark");
  expect(normalise(await mark.innerText())).toBe(normalise(quote));
  await expect(mark).toBeInViewport();
  // The passage box scrolled: the passage starts above its visible part.
  expect(await mark.locator("xpath=..").evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
});

test("while an answer streams, an unfinished marker never shows (R-09)", async ({ page }) => {
  await page.goto("/");
  // Every text the answer shows, from its first render to the end of the stream.
  await page.evaluate(() => {
    const shown: string[] = [];
    Object.assign(window, { answerTexts: shown });
    new MutationObserver(() => {
      const answer = document.querySelector('[data-message-role="assistant"] > div');
      if (answer !== null) shown.push(answer.textContent ?? "");
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await promptButton(page, 0).click();
  await expect(assistantBubbles(page)).toHaveCount(1);
  await expect(sendButton(page)).toBeVisible({ timeout: 20_000 });

  const shown = await page.evaluate(
    () => (window as unknown as { answerTexts: string[] }).answerTexts,
  );
  expect(shown.length).toBeGreaterThan(20);
  // The mock's own sentences hold no "[" or '"': only the [n] buttons may.
  for (const text of shown) {
    expect(text.replaceAll(/\[\d\]/g, "")).not.toMatch(/[["]/);
  }
  expect(shown.at(-1)).toContain("[2]");
});

test("Stop while a marker is half written shows the half marker as a malformed citation (S-12)", async ({
  page,
}) => {
  // A model that stalls in the middle of a marker: the page's fetch passes the route's reply
  // through, and holds it once the text ends inside a marker's quote. Stop aborts the request,
  // which errors the held stream as it would a real one.
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await realFetch(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/api/chat") || response.body === null) return response;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let pending = "";
      let text = "";
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) return controller.close();
          pending += decoder.decode(value, { stream: true });
          const frames = pending.split("\n\n");
          pending = frames.pop() ?? "";
          for (const frame of frames) {
            controller.enqueue(encoder.encode(`${frame}\n\n`));
            const data = frame.slice("data: ".length);
            if (!data.startsWith("{")) continue;
            const chunk = JSON.parse(data) as { type: string; delta?: string };
            if (chunk.type === "text-delta") text += chunk.delta;
            // [n: "and at least one quoted word: hold the rest of the stream.
            if (/\[\d+: "[^"]+$/.test(text)) return new Promise<void>(() => {});
          }
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    };
  });
  await page.goto("/");
  await promptButton(page, 0).click();
  const bubble = assistantBubbles(page);
  // The text up to the marker shows; the half marker stays hidden while streaming (R-09).
  await expect(answerText(bubble)).toContainText("One passage says");
  await expect(attempts(bubble)).toHaveCount(0);
  await expect(answerText(bubble)).not.toContainText("[");

  await page.getByRole("button", { name: "Stop generating" }).click();
  await expect(bubble.getByText("Stopped", { exact: true })).toBeVisible();
  // The stream has ended, so the half marker is a malformed attempt, shown as written.
  const half = attempts(bubble);
  await expect(half).toHaveCount(1);
  await expect(half).toHaveAttribute("data-citation-verified", "false");
  await expect(half).toHaveAccessibleName("Citation not in the expected format");
  await expect(half).toHaveText(/^\[\d: "\S+/);
  await expect(sourcesList(bubble)).toHaveCount(0);
});

test.describe("a citation that is not verified shows its badge", () => {
  test(`${NOT_FOUND_TRIGGER}: the quote is not in its passage`, async ({ page }) => {
    await page.goto("/");
    const { sources } = await askText(page, `${QUESTION} ${NOT_FOUND_TRIGGER}`);
    const bubble = assistantBubbles(page);
    await expect(attempts(bubble)).toHaveCount(3);
    const failed = bubble.locator('[data-citation-verified="false"]');
    await expect(failed).toHaveAccessibleName("Source 1");

    await failed.click();
    const dialog = popover(page);
    await expect(dialog.getByText("Quote not found in source", { exact: true })).toBeVisible();
    await expect(dialog).toHaveAccessibleName(shownHeading(sources[0].heading));
    // The quote the model claimed, and its passage with nothing marked.
    await expect(dialog).toContainText(NOT_FOUND_QUOTE);
    await expect(dialog.locator("mark")).toHaveCount(0);
    await expect(dialog).toContainText(sources[0].file);
    await expect(dialog.getByRole("link", { name: "View source on GitHub" })).toHaveAttribute(
      "href",
      sources[0].url,
    );

    // Passage 1 is cited twice: one quote verified, one not found (S-16).
    await expect(sourcesList(bubble).getByRole("listitem")).toContainText([
      "1 of 2 quotes verified",
      "1 of 1 quotes verified",
    ]);
  });

  test(`${UNKNOWN_SOURCE_TRIGGER}: no such source, with no passage and no link`, async ({
    page,
  }) => {
    await page.goto("/");
    const { sources } = await askText(page, `${QUESTION} ${UNKNOWN_SOURCE_TRIGGER}`);
    const bubble = assistantBubbles(page);
    await expect(attempts(bubble)).toHaveCount(3);
    const failed = bubble.locator('[data-citation-verified="false"]');
    const unknown = sources.length + 1;
    await expect(failed).toHaveAccessibleName(`Source ${unknown}`);
    await expect(failed).toHaveText(`[${unknown}]`);

    await failed.click();
    const dialog = popover(page);
    await expect(dialog).toHaveAccessibleName("No such source");
    await expect(dialog).toHaveText("No such source");
    await expect(dialog.getByRole("link")).toHaveCount(0);
    // The unknown source is not listed.
    await expect(sourcesList(bubble).getByRole("listitem")).toHaveCount(2);
  });

  test(`${MALFORMED_TRIGGER}: a citation not in the expected format, shown as written`, async ({
    page,
  }) => {
    await page.goto("/");
    await askText(page, `${QUESTION} ${MALFORMED_TRIGGER}`);
    const bubble = assistantBubbles(page);
    await expect(attempts(bubble)).toHaveCount(3);
    const failed = bubble.locator('[data-citation-verified="false"]');
    await expect(failed).toHaveText("[2]");
    await expect(failed).toHaveAccessibleName("Citation not in the expected format");

    await failed.click();
    const dialog = popover(page);
    await expect(dialog).toHaveAccessibleName("Citation not in the expected format");
    await expect(dialog).toHaveText("Citation not in the expected format");
    await expect(dialog.getByRole("link")).toHaveCount(0);
    await expect(sourcesList(bubble).getByRole("listitem")).toHaveCount(2);
  });
});

test.describe("refusals (spec §7, S-24)", () => {
  test("the out-of-scope question: data-refusal=gate, no passages sent, no Sources", async ({
    page,
  }) => {
    await page.goto("/");
    const { raw } = await ask(page, () => promptButton(page, 3).click());
    // The gate refused before the model: the response has no data-sources part (spec §5 step 6).
    expect(raw).not.toContain("data-sources");

    const bubble = assistantBubbles(page);
    await expect(bubble).toHaveAttribute("data-refusal", "gate");
    await expect(answerText(bubble)).toHaveText(REFUSAL_EN);
    await expect(attempts(bubble)).toHaveCount(0);
    await expect(sourcesList(bubble)).toHaveCount(0);
    // Regenerate stays, as in #1.
    await expect(bubble.getByRole("button", { name: "Regenerate" })).toBeVisible();
  });

  test("Regenerate after the gate's refusal gives the same refusal, again with no passages", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ask(page, () => promptButton(page, 3).click());
    const bubble = assistantBubbles(page);
    await expect(bubble).toHaveAttribute("data-refusal", "gate");

    const { raw } = await ask(page, () =>
      bubble.getByRole("button", { name: "Regenerate" }).click(),
    );
    expect(raw).not.toContain("data-sources");
    await expect(userBubbles(page)).toHaveCount(1);
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveAttribute("data-refusal", "gate");
    await expect(answerText(bubble)).toHaveText(REFUSAL_EN);
    await expect(attempts(bubble)).toHaveCount(0);
    await expect(sourcesList(bubble)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
    await expect(bubble.getByRole("button", { name: "Regenerate" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${REFUSE_TRIGGER}: the model's refusal gets data-refusal=model and no Sources`, async ({
    page,
  }) => {
    await page.goto("/");
    const { raw } = await askText(page, `${QUESTION} ${REFUSE_TRIGGER}`);
    // The gate let the question through, so the passages were sent before the model refused.
    expect(raw).toContain("data-sources");

    const bubble = assistantBubbles(page);
    await expect(bubble).toHaveAttribute("data-refusal", "model");
    await expect(answerText(bubble)).toHaveText(REFUSAL_EN);
    await expect(sourcesList(bubble)).toHaveCount(0);
    await expect(bubble.getByRole("button", { name: "Regenerate" })).toBeVisible();
  });
});

// What the route sends when the model fails before its first token (tests/api-chat-route.test.ts):
// the passages went out after the search, then the stream ends with no text.
for (const [what, failure] of [
  [
    "a first-token timeout",
    {
      type: "abort",
      reason: `TimeoutError: First chunk timeout of ${FIRST_CHUNK_TIMEOUT_MS}ms exceeded`,
    },
  ],
  ["a model error", { type: "error", errorText: SAFE_ERROR_MESSAGE }],
] as const) {
  test(`${what} after the passages, before any text: the generic banner and Retry, no Sources; Retry answers`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.route(
      "**/api/chat",
      async (route) => {
        const sse = parseSse((await (await route.fetch()).body()).toString("utf8"));
        const beforeText = sse.chunks.filter((chunk) =>
          ["start", "message-metadata", "data-sources"].includes(chunk.type),
        );
        expect(beforeText.map((chunk) => chunk.type)).toEqual([
          "start",
          "message-metadata",
          "data-sources",
        ]);
        await route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
          body: sseBody([...beforeText, failure]),
        });
      },
      { times: 1 },
    );
    await promptButton(page, 0).click();

    await expect(banner(page)).toContainText(GENERIC_ERROR_TEXT);
    await expect(retryButton(page)).toBeVisible();
    // The message holds the passages but no text, so neither it nor a Sources list shows.
    await expect(assistantBubbles(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Sources" })).toHaveCount(0);
    await expect(page.getByTestId("stopped-row")).toHaveCount(0);

    const { sources } = await ask(page, () => retryButton(page).click());
    const bubble = assistantBubbles(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(userBubbles(page)).toHaveCount(1);
    await expect(bubble).toHaveCount(1);
    await expect(attempts(bubble)).toHaveCount(2);
    await expect(bubble.locator('[data-citation-verified="false"]')).toHaveCount(0);
    await expect(sourcesList(bubble).getByRole("listitem")).toHaveCount(2);
    expect(sources).toHaveLength(5);
  });
}

test("Esc in an open popover closes only the popover; the answer keeps streaming", async ({
  page,
}) => {
  await page.goto("/");
  await composer(page).fill(`${QUESTION} ${SLOW_TRIGGER}`);
  await sendButton(page).click();
  const bubble = assistantBubbles(page);
  const button = sourceButton(bubble, 1);
  // The [[slow]] answer cites before its 300 lines, so the button shows while it streams.
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(popover(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(popover(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  const length = await answerText(bubble).evaluate((element) => element.textContent?.length);
  await expect
    .poll(() => answerText(bubble).evaluate((element) => element.textContent?.length))
    .toBeGreaterThan(length ?? 0);

  // With the popover closed, Esc stops the answer from anywhere (#1 D-S-06).
  await page.keyboard.press("Escape");
  await expect(bubble.getByText("Stopped", { exact: true })).toBeVisible();
});

test.describe("a phone at 375×812 with touch", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("each [n] popover stays inside the screen and closes with Escape and with a tap outside", async ({
    page,
  }) => {
    await page.goto("/");
    await ask(page, () => promptButton(page, 0).tap());
    const bubble = assistantBubbles(page);
    const dialog = popover(page);
    const viewport = page.viewportSize()!;

    for (const n of [1, 2]) {
      await sourceButton(bubble, n).tap();
      await expect(dialog).toBeVisible();
      // Measured once the opening zoom has finished.
      await dialog.evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished)),
      );
      const box = (await dialog.boundingBox())!;
      expect(box.x, `left of popover ${n}`).toBeGreaterThanOrEqual(0);
      expect(box.y, `top of popover ${n}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `right of popover ${n}`).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height, `bottom of popover ${n}`).toBeLessThanOrEqual(viewport.height);

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      await sourceButton(bubble, n).tap();
      await expect(dialog).toBeVisible();
      await page.locator("header").tap({ position: { x: 5, y: 5 } });
      await expect(dialog).toHaveCount(0);
    }
    // Neither close stopped anything or left the page scrolled sideways.
    await expect(bubble.getByText("Stopped", { exact: true })).toHaveCount(0);
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });

  test("44 px targets for [n], the Sources links and the popover's link; no sideways scroll", async ({
    page,
  }) => {
    await page.goto("/");
    await ask(page, () => promptButton(page, 0).tap());
    const bubble = assistantBubbles(page);

    for (const n of [1, 2]) {
      expect(await height(sourceButton(bubble, n)), `height of Source ${n}`).toBeGreaterThanOrEqual(
        44,
      );
    }
    const links = sourcesList(bubble).getByRole("link");
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      expect(await height(link), "height of a Sources link").toBeGreaterThanOrEqual(44);
    }

    await sourceButton(bubble, 1).tap();
    const dialog = popover(page);
    await expect(dialog).toBeVisible();
    // Measured once the opening zoom has finished.
    await dialog.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    const link = dialog.getByRole("link", { name: "View source on GitHub" });
    expect(await height(link)).toBeGreaterThanOrEqual(44);
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);

    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });
});
