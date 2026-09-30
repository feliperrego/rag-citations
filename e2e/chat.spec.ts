import { randomInt } from "node:crypto";
import { expect, test, type Locator, type Page, type Request, type Route } from "@playwright/test";
import { ERROR_TRIGGER, SLOW_TRIGGER } from "@/lib/ai/mock-scenarios";
import { FIRST_CHUNK_TIMEOUT_MS, MAX_USER_CHARS } from "@/lib/chat/config";
import { mockWords } from "@/lib/rag/embedder";

// E2E for the chat shell copied from #1 (spec §7, R-07): the production build in mock mode
// (AI_MOCK=1), zero cost. The mock model's first chunk arrives 600 ms after the passages;
// [[slow]] adds 300 lines, 30 ms apart; [[error]] fails the first time the server sees a
// question text (spec §10). The mock gate refuses most questions outright, so a test that needs
// an answer asks an in-scope one (tests/mock-threshold.test.ts pins their scores).

// The four suggested questions (spec §7.1), re-declared as literals so that a rewording fails
// here instead of moving with the dictionary.
const PROMPTS = [
  "How do I embed many values in parallel?",
  "How can I test my code without calling a real model?",
  "How do I rerank search results?",
  "How do I enable dark mode in Tailwind CSS?",
] as const;
const QUESTION = PROMPTS[2];
const SLOW_QUESTION = `${QUESTION} ${SLOW_TRIGGER}`;
const GENERIC_ERROR_TEXT = "Couldn't get a response. Check your connection and try again.";
// What rateLimitResponse() sends with the default RATE_LIMIT_PER_HOUR (template §5.3).
const LIMIT_TEXT = "Demo limit reached: 20 messages per hour. Try again later.";
// The mock's default answer (mockAnswer in lib/ai/mock-scenarios.ts), first to last words.
const FULL_DEFAULT_ANSWER = /^This answer comes from the mock model, [\s\S]* are shown as code\.$/;

/** The body the chat posts (S-17): the latest message, the chat id and the locale. */
type ChatRequestBody = {
  id: string;
  locale?: unknown;
  message: { id: string; role: string; parts: { type: string; text?: string }[] };
};

const header = (page: Page) => page.locator("header[data-model]");
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const sendButton = (page: Page) => page.getByRole("button", { name: "Send message" });
const stopButton = (page: Page) => page.getByRole("button", { name: "Stop generating" });
const retryButton = (page: Page) => page.getByRole("button", { name: "Retry" });
const regenerateButtons = (page: Page) => page.getByRole("button", { name: "Regenerate" });
const jumpButton = (page: Page) => page.getByRole("button", { name: "Jump to latest" });
const promptButton = (page: Page, index: number) =>
  page.getByRole("button", { name: PROMPTS[index], exact: true });
const conversation = (page: Page) => page.getByRole("log", { name: "Conversation" });
// The scroll container is the parent of the role="log" list.
const scroller = (page: Page) => conversation(page).locator("xpath=..");
const userBubbles = (page: Page) => page.locator('[data-message-role="user"]');
const assistantBubbles = (page: Page) => page.locator('[data-message-role="assistant"]');
// The error banner. The shadcn Alert carries role="alert"; Next.js's route announcer
// also has role="alert", so the banner is located by its data-slot.
const banner = (page: Page) => page.locator('[data-slot="alert"]');
const stoppedRow = (page: Page) => page.getByTestId("stopped-row");
const typingDots = (page: Page) => page.getByTestId("typing-indicator");
// The sr-only live region the chat announces "Response failed/stopped/complete" through.
const statusRegion = (page: Page) => page.locator('div[role="status"].sr-only');
// The answer text is the first child of an assistant bubble; the caption row follows it.
const answerText = (bubble: Locator) => bubble.locator(":scope > div").first();

function isChatPost(request: Request): boolean {
  return request.method() === "POST" && new URL(request.url()).pathname === "/api/chat";
}

/** One SSE frame per chunk, exactly as createUIMessageStreamResponse writes it, then [DONE]. */
function sse(chunks: object[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

/** Fulfills a route with a UI-message-stream SSE body, with the headers the real route sends. */
async function fulfillSse(route: Route, body: string): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
    body,
  });
}

/** A one-shot SSE answer: start, one text part, then finish (default finishReason "stop"). */
function textAnswer(text: string, finishReason = "stop"): string {
  return sse([
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "finish-step" },
    { type: "finish", finishReason },
  ]);
}

/**
 * Words the mock embedder skips (it keeps words of 3 or more characters), so a question keeps
 * its mock score with this appended. It makes an [[error]] question unique per run.
 */
function uniqueTag(): string {
  return Array.from({ length: 6 }, () => String(randomInt(100)).padStart(2, "0")).join("-");
}

async function sendText(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await sendButton(page).click();
}

/** Waits until the request is over: the Stop button has turned back into Send. */
async function waitUntilIdle(page: Page): Promise<void> {
  await expect(sendButton(page)).toBeVisible({ timeout: 20_000 });
}

/** Waits until the page shows `count` answers and the last request is over. */
async function waitForAnswers(page: Page, count = 1): Promise<void> {
  await expect(assistantBubbles(page)).toHaveCount(count, { timeout: 20_000 });
  await waitUntilIdle(page);
}

async function textLength(bubble: Locator): Promise<number> {
  return answerText(bubble).evaluate((element) => element.textContent?.length ?? 0);
}

/** Records a measured value in the test report, to diagnose a flake. */
function annotate(type: string, value: number): void {
  test.info().annotations.push({ type, description: String(value) });
}

type ScrollState = {
  scrollTop: number;
  scrollHeight: number;
  /** How far the content extends past the view. */
  overflow: number;
  /** Distance between the bottom of the view and the bottom of the content. */
  fromBottom: number;
};

async function scrollState(page: Page): Promise<ScrollState> {
  return scroller(page).evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    overflow: element.scrollHeight - element.clientHeight,
    fromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
  }));
}

async function distanceFromBottom(page: Page): Promise<number> {
  return (await scrollState(page)).fromBottom;
}

/** Waits until a scroll has settled: two equal scrollTop readings 50 ms apart. */
async function waitForScrollToSettle(page: Page): Promise<void> {
  let lastTop = Number.NaN;
  await expect
    .poll(
      async () => {
        const { scrollTop } = await scrollState(page);
        const settled = scrollTop === lastTop;
        lastTop = scrollTop;
        return settled;
      },
      { intervals: [50] },
    )
    .toBe(true);
}

test("1. a suggested question streams in word by word, under the mock-model badge", async ({
  page,
}) => {
  await page.goto("/");
  // Every length the answer's text takes, from its first render to the end of the stream. The
  // observer sees each render, so the check does not depend on where a timed poll lands, and a
  // pause in the visible text (a citation marker is hidden until it closes) cannot fail it.
  await page.evaluate(() => {
    const lengths: number[] = [];
    Object.assign(window, { answerLengths: lengths });
    new MutationObserver(() => {
      const answer = document.querySelector('[data-message-role="assistant"] > div');
      if (answer !== null) lengths.push(answer.textContent?.length ?? 0);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await promptButton(page, 0).click();
  // Sending refocuses the composer on a fine pointer, so typing the next message needs no click.
  await expect(composer(page)).toBeFocused();
  await expect(typingDots(page)).toBeVisible();
  await expect(userBubbles(page)).toHaveText([PROMPTS[0]]);

  const bubble = assistantBubbles(page);
  await expect(bubble).toHaveCount(1);
  await waitUntilIdle(page);
  await expect(answerText(bubble)).toHaveText(FULL_DEFAULT_ANSWER);
  await expect(header(page).getByText("Mock model", { exact: true })).toBeVisible();

  // The text grew chunk by chunk, from a first word to the whole answer, and never shrank.
  const lengths = await page.evaluate(
    () => (window as unknown as { answerLengths: number[] }).answerLengths,
  );
  const final = await textLength(bubble);
  const recorded = `answer lengths: ${lengths.join(", ")}`;
  for (let i = 1; i < lengths.length; i++) {
    expect(lengths[i], recorded).toBeGreaterThanOrEqual(lengths[i - 1]);
  }
  expect(new Set(lengths).size, recorded).toBeGreaterThan(20);
  expect(lengths[0], recorded).toBeLessThan(final / 4);
  expect(lengths.at(-1), recorded).toBe(final);
});

test.describe("2. stop", () => {
  /** After a Stop: the text no longer grows, it is labeled Stopped, Send is back and the composer has focus. */
  async function expectStoppedMidAnswer(page: Page, bubble: Locator): Promise<void> {
    const length = await textLength(bubble);
    await page.waitForTimeout(500);
    expect(await textLength(bubble)).toBe(length);
    await expect(bubble.getByText("Stopped", { exact: true })).toBeVisible();
    await expect(sendButton(page)).toBeVisible();
    await expect(composer(page)).toBeFocused();
  }

  test("the Stop button keeps the partial text, labeled Stopped", async ({ page }) => {
    await page.goto("/");
    await sendText(page, SLOW_QUESTION);
    const bubble = assistantBubbles(page);
    await expect(bubble).toHaveCount(1);
    await stopButton(page).click();
    await expectStoppedMidAnswer(page, bubble);
  });

  test("Esc stops from anywhere on the page", async ({ page }) => {
    await page.goto("/");
    await sendText(page, SLOW_QUESTION);
    const bubble = assistantBubbles(page);
    await expect(bubble).toHaveCount(1);
    await composer(page).blur();
    await expect(composer(page)).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expectStoppedMidAnswer(page, bubble);
  });
});

test("3. Stop before the first token shows the stopped row; its Regenerate gives one answer", async ({
  page,
}) => {
  await page.goto("/");
  await composer(page).fill(QUESTION);
  const sentAt = Date.now();
  await sendButton(page).click();
  await stopButton(page).click();
  annotate("send-to-stop-ms", Date.now() - sentAt);

  await expect(stoppedRow(page)).toHaveText("Stopped before a response · Regenerate");
  // Past the mock's 600 ms first-token delay: nothing arrived.
  await page.waitForTimeout(1000);
  await expect(stoppedRow(page)).toBeVisible();
  await expect(assistantBubbles(page)).toHaveCount(0);

  await stoppedRow(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(stoppedRow(page)).toHaveCount(0);
  await waitForAnswers(page);
  await expect(answerText(assistantBubbles(page))).toHaveText(FULL_DEFAULT_ANSWER);
  await expect(userBubbles(page)).toHaveCount(1);
});

test("4. Regenerate posts only the question again and shows one new answer", async ({ page }) => {
  await page.goto("/");
  await sendText(page, QUESTION);
  await waitForAnswers(page);
  const bubble = assistantBubbles(page);
  await expect(answerText(bubble)).toHaveText(FULL_DEFAULT_ANSWER);

  const posted = page.waitForRequest(isChatPost);
  await regenerateButtons(page).click();
  // The old answer is gone at once; the new one streams in after the mock's first-token delay.
  await expect(bubble).toHaveCount(0);
  // Regenerate refocuses the composer on a fine pointer, same as sending.
  await expect(composer(page)).toBeFocused();
  // The body holds the question alone: no history and no old answer (S-17).
  expect((await posted).postDataJSON()).toEqual({
    id: expect.any(String),
    locale: "en",
    message: { id: expect.any(String), role: "user", parts: [{ type: "text", text: QUESTION }] },
  });

  await waitForAnswers(page);
  await expect(answerText(bubble)).toHaveText(FULL_DEFAULT_ANSWER);
  await expect(userBubbles(page)).toHaveCount(1);
  await expect(regenerateButtons(page)).toHaveCount(1);
});

test.describe("5. autoscroll", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("follows the stream, stops on wheel up, resumes with Jump to latest", async ({ page }) => {
    await page.goto("/");
    await sendText(page, SLOW_QUESTION);
    // Wait until the answer overflows the view by a good margin.
    await expect
      .poll(async () => (await scrollState(page)).overflow, { timeout: 10_000 })
      .toBeGreaterThan(400);

    // Following: within 2 px of the bottom while the content grows.
    const heightBefore = (await scrollState(page)).scrollHeight;
    for (let i = 0; i < 5; i++) {
      expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
      await page.waitForTimeout(150);
    }
    expect((await scrollState(page)).scrollHeight).toBeGreaterThan(heightBefore);
    await expect(jumpButton(page)).toHaveCount(0);

    // An upward wheel mid-stream stops following: the view stays put while text arrives.
    const box = await scroller(page).boundingBox();
    if (box === null) throw new Error("The scroll container is not visible.");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await expect(jumpButton(page)).toBeVisible();
    await waitForScrollToSettle(page);
    const settled = await scrollState(page);
    expect(await distanceFromBottom(page)).toBeGreaterThan(80);
    await page.waitForTimeout(500);
    const later = await scrollState(page);
    expect(Math.abs(later.scrollTop - settled.scrollTop)).toBeLessThanOrEqual(2);
    expect(later.scrollHeight).toBeGreaterThan(settled.scrollHeight);
    await expect(jumpButton(page)).toBeVisible();

    // Jump to latest returns to the bottom, and following resumes while the stream goes on.
    await jumpButton(page).click();
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);
    await expect(jumpButton(page)).toHaveCount(0);
    const heightAfterJump = (await scrollState(page)).scrollHeight;
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(150);
      expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
    }
    expect((await scrollState(page)).scrollHeight).toBeGreaterThan(heightAfterJump);
    await expect(stopButton(page)).toBeVisible();
    await stopButton(page).click();
  });

  // While following, each pin moves the view down, and its scroll event reaches the hook only at
  // the next rendering step. A stop intent that lands in between must hold when that event
  // arrives (the race X-01's review found in this hook; template §14). Here the stream is
  // stopped, so no real pin moves the view: a script plays the pin and the stop intent in one
  // task, which fixes their order. Script-made events have no default action, so nothing else
  // scrolls.
  for (const intent of ["PageUp", "wheel up", "touch move down"] as const) {
    test(`a scroll event queued before a stop by ${intent} does not undo it`, async ({ page }) => {
      await page.goto("/");
      await sendText(page, SLOW_QUESTION);
      await expect
        .poll(async () => (await scrollState(page)).overflow, { timeout: 10_000 })
        .toBeGreaterThan(400);
      await stopButton(page).click();
      await expect(statusRegion(page)).toHaveText("Response stopped");
      await waitForScrollToSettle(page);
      expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);

      // 30 px up: still near the bottom, so the view keeps following, and the last scroll
      // position the hook saw is 30 px above the bottom.
      await scroller(page).evaluate(async (element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight - 30;
        // Scroll events fire in the rendering step, before its animation frame callbacks.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.waitForTimeout(300);
      await expect(jumpButton(page)).toHaveCount(0);

      await scroller(page).evaluate((element, intent) => {
        // The pin: a move down to the bottom, whose scroll event is now queued.
        element.scrollTop = element.scrollHeight;
        // The stop intent, before that event.
        if (intent === "PageUp") {
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }),
          );
        } else if (intent === "wheel up") {
          element.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
        } else {
          // The finger moving down scrolls the content up.
          const at = (clientY: number) => [new Touch({ identifier: 1, target: element, clientY })];
          element.dispatchEvent(new TouchEvent("touchstart", { touches: at(100), bubbles: true }));
          element.dispatchEvent(new TouchEvent("touchmove", { touches: at(140), bubbles: true }));
        }
      }, intent);
      await expect(jumpButton(page)).toBeVisible();
      // Give the queued scroll event time to arrive and a buggy handler time to re-render.
      await page.waitForTimeout(300);
      await expect(jumpButton(page)).toBeVisible();
    });
  }

  test("wheel up over a conversation that does not overflow never shows Jump to latest", async ({
    page,
  }) => {
    await page.goto("/");
    await sendText(page, QUESTION);
    await waitForAnswers(page);
    expect((await scrollState(page)).overflow).toBeLessThanOrEqual(0);

    const box = await scroller(page).boundingBox();
    if (box === null) throw new Error("The scroll container is not visible.");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    // Give a buggy handler time to flip isFollowing and re-render before asserting
    // absence — otherwise a false pass could slip through before React re-renders.
    await page.waitForTimeout(300);

    await expect(jumpButton(page)).toHaveCount(0);
  });
});

test.describe("6. errors", () => {
  test("429 shows the translated limit text with no Retry; a later send succeeds", async ({
    page,
  }) => {
    await page.goto("/");
    // The banner shows the client's errors.limit text, never the 429 body (#1 delta spec §4.4).
    // In English that text equals the server's LIMIT_TEXT, so the body here differs from it.
    const serverBody = "server limit text";
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 429,
        contentType: "text/plain; charset=utf-8",
        headers: { "Retry-After": "3600" },
        body: serverBody,
      }),
    );
    await sendText(page, QUESTION);
    await expect(banner(page)).toHaveText(LIMIT_TEXT);
    await expect(banner(page)).not.toContainText(serverBody);
    await expect(banner(page)).toHaveAttribute("role", "alert");
    await expect(retryButton(page)).toHaveCount(0);

    await page.unroute("**/api/chat");
    await sendText(page, QUESTION);
    await waitForAnswers(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(answerText(assistantBubbles(page))).toHaveText(FULL_DEFAULT_ANSWER);
  });

  test("a 500 HTML page shows the generic banner and never renders the HTML", async ({ page }) => {
    await page.goto("/");
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/html; charset=utf-8",
        body: "<!DOCTYPE html><html><body><h1>Upstream exploded</h1><p>Internal Server Error</p></body></html>",
      }),
    );
    await sendText(page, QUESTION);
    await expect(banner(page)).toContainText(GENERIC_ERROR_TEXT);
    await expect(retryButton(page)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Upstream exploded");
    await expect(page.locator("body")).not.toContainText("<h1>");
    await expect(page.locator("h1", { hasText: "Upstream exploded" })).toHaveCount(0);
  });

  test("a network reset shows the generic banner; Retry succeeds with no duplicated user bubble", async ({
    page,
  }) => {
    await page.goto("/");
    await page.route("**/api/chat", (route) => route.abort("connectionreset"));
    await sendText(page, QUESTION);
    await expect(banner(page)).toContainText(GENERIC_ERROR_TEXT);
    await expect(retryButton(page)).toBeVisible();

    await page.unroute("**/api/chat");
    await retryButton(page).click();
    await waitForAnswers(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(userBubbles(page)).toHaveCount(1);
  });

  test("[[error]] keeps the partial text under the generic banner; Retry streams the full answer", async ({
    page,
  }) => {
    await page.goto("/");
    // The server fails each [[error]] question text only once per process, so make it unique.
    const tag = uniqueTag();
    expect(mockWords(tag)).toEqual([]);
    await sendText(page, `${QUESTION} ${ERROR_TRIGGER} ${tag}`);
    await expect(banner(page)).toContainText(GENERIC_ERROR_TEXT);
    const bubble = assistantBubbles(page);
    await expect(answerText(bubble)).toHaveText("This answer fails");
    // #1 spec §14 A-15: Regenerate (under the partial answer) and the banner's Retry show at once.
    await expect(regenerateButtons(page)).toHaveCount(1);
    await expect(retryButton(page)).toHaveCount(1);

    await retryButton(page).click();
    await expect(answerText(bubble)).toHaveText(FULL_DEFAULT_ANSWER, { timeout: 20_000 });
    await waitUntilIdle(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(bubble).toHaveCount(1);
    await expect(userBubbles(page)).toHaveCount(1);
  });
});

test.describe("7. input and New chat", () => {
  test("whitespace-only input keeps Send disabled", async ({ page }) => {
    await page.goto("/");
    await composer(page).fill("   \n\t  ");
    await expect(sendButton(page)).toBeDisabled();
    await composer(page).press("Enter");
    await expect(userBubbles(page)).toHaveCount(0);
  });

  test(`input over ${MAX_USER_CHARS} characters is truncated`, async ({ page }) => {
    await page.goto("/");
    await composer(page).fill("x".repeat(MAX_USER_CHARS + 100));
    expect((await composer(page).inputValue()).length).toBe(MAX_USER_CHARS);
  });

  test("pressing Enter twice within 50 ms sends exactly one request", async ({ page }) => {
    await page.goto("/");
    let posts = 0;
    page.on("request", (request) => {
      if (isChatPost(request)) posts++;
    });
    await composer(page).fill(QUESTION);
    await expect(composer(page)).toBeFocused();
    // The page records when each Enter was pressed (the keydown's timeStamp).
    await page.evaluate(() => {
      const pressedAt: number[] = [];
      Object.assign(window, { enterPressedAt: pressedAt });
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter") pressedAt.push(event.timeStamp);
        },
        { capture: true },
      );
    });
    // Two trusted Enter presses sent as one burst, so the gap between them does not
    // depend on test-runner latency: two sequential keyboard.press() calls took up to
    // 30 ms under load. The browser still handles each keydown as its own task.
    const cdp = await page.context().newCDPSession(page);
    const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    const enterDown = { type: "keyDown", text: "\r", unmodifiedText: "\r", ...enter } as const;
    const enterUp = { type: "keyUp", ...enter } as const;
    await Promise.all([
      cdp.send("Input.dispatchKeyEvent", enterDown),
      cdp.send("Input.dispatchKeyEvent", enterUp),
      cdp.send("Input.dispatchKeyEvent", enterDown),
      cdp.send("Input.dispatchKeyEvent", enterUp),
    ]);
    const pressedAt = await page.evaluate(
      () => (window as unknown as { enterPressedAt: number[] }).enterPressedAt,
    );
    expect(pressedAt).toHaveLength(2);
    const gapMs = pressedAt[1] - pressedAt[0];
    annotate("double-enter-gap-ms", gapMs);
    expect(gapMs).toBeLessThan(50);

    await expect(stopButton(page)).toBeVisible();
    // #1 spec §6 "Regenerate is hidden while busy": no Regenerate button while streaming.
    await expect(regenerateButtons(page)).toHaveCount(0);
    await waitForAnswers(page);
    expect(posts, "POST /api/chat requests").toBe(1);
    await expect(userBubbles(page)).toHaveCount(1);
  });

  test("New chat clears the conversation and shows the empty state", async ({ page }) => {
    await page.goto("/");
    await sendText(page, QUESTION);
    await waitForAnswers(page);

    await header(page).getByRole("button", { name: "New chat" }).click();
    await expect(userBubbles(page)).toHaveCount(0);
    await expect(assistantBubbles(page)).toHaveCount(0);
    await expect(conversation(page)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "Ask the AI SDK Core docs", exact: true }),
    ).toBeVisible();
    for (const prompt of PROMPTS) {
      await expect(page.getByRole("button", { name: prompt, exact: true })).toBeVisible();
    }
  });
});

test.describe("8. failure modes", () => {
  test("timeout before the first token (abort chunk, no finish): generic banner with Retry, no Stopped row; Retry recovers", async ({
    page,
  }) => {
    await page.goto("/");
    // What the real route sends when streamText's firstChunkMs timeout fires (#1 spec §2.3):
    // an `abort` chunk with no preceding text and no `finish`.
    await page.route("**/api/chat", (route) =>
      fulfillSse(
        route,
        sse([
          { type: "start" },
          {
            type: "abort",
            reason: `TimeoutError: First chunk timeout of ${FIRST_CHUNK_TIMEOUT_MS}ms exceeded`,
          },
        ]),
      ),
    );
    await sendText(page, QUESTION);
    await expect(banner(page)).toContainText(GENERIC_ERROR_TEXT);
    await expect(retryButton(page)).toBeVisible();
    await expect(stoppedRow(page)).toHaveCount(0);
    await expect(assistantBubbles(page)).toHaveCount(0);
    await expect(statusRegion(page)).toHaveText("Response failed");

    await page.unroute("**/api/chat");
    await retryButton(page).click();
    await waitForAnswers(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(answerText(assistantBubbles(page))).toHaveText(FULL_DEFAULT_ANSWER);
    await expect(userBubbles(page)).toHaveCount(1);
  });

  test("finishReason length shows 'Cut at demo length limit'", async ({ page }) => {
    await page.goto("/");
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, textAnswer("A long answer that the demo cuts short.", "length")),
    );
    await sendText(page, QUESTION);
    await waitForAnswers(page);
    const bubble = assistantBubbles(page);
    await expect(bubble.getByText("Cut at demo length limit", { exact: true })).toBeVisible();
    await expect(regenerateButtons(page)).toHaveCount(1);
    await expect(banner(page)).toHaveCount(0);
  });

  test("New chat while streaming aborts the request, shows the empty state and no late bubble appears", async ({
    page,
  }) => {
    await page.goto("/");
    let abortedRequests = 0;
    page.on("requestfailed", (request) => {
      if (isChatPost(request)) abortedRequests++;
    });

    await sendText(page, SLOW_QUESTION);
    await expect(assistantBubbles(page)).toHaveCount(1);

    await header(page).getByRole("button", { name: "New chat" }).click();
    await expect(conversation(page)).toHaveCount(0);
    await expect(userBubbles(page)).toHaveCount(0);
    await expect(assistantBubbles(page)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
    await expect(sendButton(page)).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Ask the AI SDK Core docs", exact: true }),
    ).toBeVisible();

    // Past the mock's 600 ms first-token delay: the aborted stream never reaches the page.
    await page.waitForTimeout(1000);
    await expect(userBubbles(page)).toHaveCount(0);
    await expect(assistantBubbles(page)).toHaveCount(0);
    expect(abortedRequests).toBe(1);

    await promptButton(page, 1).click();
    await expect(assistantBubbles(page)).toHaveCount(1);
    await stopButton(page).click();
  });

  test("New chat clears an error banner", async ({ page }) => {
    await page.goto("/");
    await page.route("**/api/chat", (route) => route.abort("connectionreset"));
    await sendText(page, QUESTION);
    await expect(banner(page)).toContainText(GENERIC_ERROR_TEXT);

    await header(page).getByRole("button", { name: "New chat" }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect(userBubbles(page)).toHaveCount(0);
    await expect(conversation(page)).toHaveCount(0);
    await expect(promptButton(page, 0)).toBeVisible();
  });

  test("no message cap: each request posts only its question, and the composer stays enabled", async ({
    page,
  }) => {
    await page.goto("/");
    const posted: ChatRequestBody[] = [];
    await page.route("**/api/chat", async (route) => {
      posted.push(route.request().postDataJSON() as ChatRequestBody);
      await fulfillSse(route, textAnswer("ok"));
    });

    // 22 messages, past #1's cap of 20: no history is sent, so no cap applies (S-17).
    const roundTrips = 11;
    for (let i = 0; i < roundTrips; i++) {
      await sendText(page, `question ${i + 1}`);
      await waitForAnswers(page, i + 1);
    }

    expect(posted.map((body) => Object.keys(body).sort())).toEqual(
      posted.map(() => ["id", "locale", "message"]),
    );
    expect(posted.map((body) => body.message.parts)).toEqual(
      posted.map((_, i) => [{ type: "text", text: `question ${i + 1}` }]),
    );
    await expect(userBubbles(page)).toHaveCount(roundTrips);
    await expect(composer(page)).toBeEnabled();
    await expect(composer(page)).toHaveAttribute("placeholder", "Send a message");
  });

  test.describe("touch device", () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test("touch: no autofocus, no refocus after Stop, 44 px targets, no horizontal scroll", async ({
      page,
    }) => {
      await page.goto("/");
      const isCoarsePointer = await page.evaluate(
        () => window.matchMedia("(pointer: coarse)").matches,
      );
      expect(isCoarsePointer).toBe(true);
      await expect(composer(page)).not.toBeFocused();

      for (const name of [...PROMPTS, "New chat"]) {
        const box = await page.getByRole("button", { name, exact: true }).boundingBox();
        expect(box?.height, `height of "${name}"`).toBeGreaterThanOrEqual(44);
      }

      // One column below sm: the second suggested question sits directly under the first.
      const first = (await promptButton(page, 0).boundingBox())!;
      const second = (await promptButton(page, 1).boundingBox())!;
      expect(second.y).toBeGreaterThan(first.y);
      expect(second.x).toBe(first.x);

      await composer(page).tap();
      await composer(page).fill(SLOW_QUESTION);
      await composer(page).blur();
      const sendBox = (await sendButton(page).boundingBox())!;
      expect(sendBox.height).toBeGreaterThanOrEqual(44);

      await sendButton(page).tap();
      await expect(assistantBubbles(page)).toHaveCount(1);
      const stopBox = (await stopButton(page).boundingBox())!;
      expect(stopBox.height).toBeGreaterThanOrEqual(44);

      await stopButton(page).tap();
      await expect(assistantBubbles(page).getByText("Stopped", { exact: true })).toBeVisible();
      await expect(composer(page)).not.toBeFocused();

      const regenBox = (await regenerateButtons(page).boundingBox())!;
      expect(regenBox.height).toBeGreaterThanOrEqual(44);

      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    });

    // A rotation that makes the text above the view take fewer lines (here the question and the
    // answer's first paragraph): Chromium's scroll anchoring moves the view up by the lines saved.
    // On the template's Linux CI that scroll event reached the hook before the resize observer
    // pinned the view, so following stopped (template §14). The hook turns anchoring off while
    // following, so the view never moves up. The resize is sent through CDP together with a read
    // of scrollTop, which lands before the next frame and so sees a move up if there is one.
    test("touch: a rotation never moves a followed view up", async ({ page }) => {
      await page.goto("/");
      await composer(page).tap();
      await composer(page).fill(SLOW_QUESTION);
      await sendButton(page).tap();
      await waitUntilIdle(page);
      await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);
      const before = (await scrollState(page)).scrollTop;

      await scroller(page).evaluate((element) => {
        (window as unknown as { scroller: Element }).scroller = element;
        // An animation frame loop keeps the page rendering, so the frame after the resize waits
        // for the next vsync and the read lands before it. On an idle page Chromium sometimes
        // ran that frame first, and the resize observer had pinned the view by the read.
        const tick = () => requestAnimationFrame(tick);
        requestAnimationFrame(tick);
      });
      const cdp = await page.context().newCDPSession(page);
      const scale = await page.evaluate(() => window.devicePixelRatio);
      const [, read] = await Promise.all([
        cdp.send("Emulation.setDeviceMetricsOverride", {
          width: 812,
          height: 375,
          deviceScaleFactor: scale,
          mobile: true,
        }),
        cdp.send("Runtime.evaluate", {
          expression: "(window.scroller).scrollTop",
          returnByValue: true,
        }),
      ]);
      // Below 0: anchoring moved the view up. 0: the read landed before the frame, as meant.
      // Above 0: the frame ran first and pinned the view, so the read proved nothing.
      annotate("rotation-read-minus-before-px", read.result.value - before);
      expect(read.result.value, "scrollTop at the first layout after rotating").toBeGreaterThanOrEqual(
        before,
      );
      await expect
        .poll(() => distanceFromBottom(page), { message: "distance from bottom after rotating" })
        .toBeLessThanOrEqual(2);
      await expect(jumpButton(page)).toHaveCount(0);
    });
  });
});
