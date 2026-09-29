import type { Page, Route } from "@playwright/test";

/** The route's reply to one question: its status and its body as UTF-8. */
export type ChatReply = { status: number; body: string };

/**
 * Runs `send` and returns the reply to the one POST /api/chat it makes. The reply passes
 * through page.route, whose fetch gives its exact bytes: Response.body() of the streamed reply,
 * which has no charset, came back decoded as Windows-1252 ("›" as "â€º"). The page then gets
 * the reply whole, so a test that watches the stream does without this.
 *
 * `timeout` limits both the wait for the POST, from the start of `send`, and the route's fetch
 * of the reply; without it, only the test's own timeout does. `send` must limit its own steps.
 */
export async function captureChatReply(
  page: Page,
  send: () => Promise<void>,
  { timeout }: { timeout?: number } = {},
): Promise<ChatReply> {
  const received = Promise.withResolvers<ChatReply>();
  // The timer can reject while `send` still runs, before the promise is awaited below.
  received.promise.catch(() => {});
  const noRequest =
    timeout === undefined
      ? undefined
      : setTimeout(
          () => received.reject(new Error(`no POST /api/chat within ${timeout} ms`)),
          timeout,
        );
  const handler = async (route: Route) => {
    clearTimeout(noRequest);
    try {
      const response = await route.fetch({ timeout });
      const body = (await response.body()).toString("utf8");
      await route.fulfill({ response });
      received.resolve({ status: response.status(), body });
    } catch (error) {
      received.reject(error);
      await route.abort().catch(() => {});
    }
  };
  await page.route("**/api/chat", handler, { times: 1 });
  try {
    await send();
    return await received.promise;
  } finally {
    clearTimeout(noRequest);
    // A capture that saw no request leaves no handler behind for a later one.
    await page.unroute("**/api/chat", handler).catch(() => {});
  }
}
