import { expect, test, type Page, type Request } from "@playwright/test";
import {
  MALFORMED_TRIGGER,
  NOT_FOUND_TRIGGER,
  SLOW_TRIGGER,
  UNKNOWN_SOURCE_TRIGGER,
} from "@/lib/ai/mock-scenarios";
import { messages } from "@/lib/i18n/messages";

// E2E for the interface language (spec §7.1, §9, R-21), ported from #1: the production build in
// mock mode. The page is prerendered in English and switches after hydration (#1 delta spec
// §4.2), so Portuguese is asserted web-first only, and English only once the page has hydrated.
// The expected strings are literals, as in chat.spec.ts. Only the negative sweep reads the
// dictionary, to find every English string.

// The suggested questions in both languages (spec §7.1).
const PROMPTS_EN = [
  "How do I embed many values in parallel?",
  "How can I test my code without calling a real model?",
  "How do I rerank search results?",
  "How do I enable dark mode in Tailwind CSS?",
] as const;
const PROMPTS_PT = [
  "Como gerar embeddings de vários textos em paralelo?",
  "Como testar meu código sem chamar um modelo de verdade?",
  "Como reordenar resultados de busca (rerank)?",
  "Como ativo o modo escuro no Tailwind CSS?",
] as const;
// An in-scope English question with the [[slow]] trigger (spec §10). The mock threshold is one
// number, so the mock gate lets it through under either interface language.
const SLOW_QUESTION = `${PROMPTS_EN[2]} ${SLOW_TRIGGER}`;
// What rateLimitResponse() sends with the default RATE_LIMIT_PER_HOUR, as in chat.spec.ts.
const LIMIT_TEXT = "Demo limit reached: 20 messages per hour. Try again later.";
const LIMIT_TEXT_PT = "Limite da demo atingido: 20 mensagens por hora. Tente mais tarde.";
// The refusal sentences (spec §7.1, R-17).
const REFUSAL_EN = "I don't know. The AI SDK Core docs I search don't cover that.";
const REFUSAL_PT = "Não sei. A documentação do AI SDK Core que eu consulto não cobre isso.";

// What the empty state shows and what a phone taps, in each language (spec §7.1).
type UiStrings = {
  title: string;
  subtitle: string;
  corpusNote: string;
  rateNote: string;
  prompts: readonly string[];
  newChat: string;
  send: string;
  stop: string;
};
const UI_EN: UiStrings = {
  title: "Ask the AI SDK Core docs",
  subtitle: "Every answer cites the passage it used, and each quote is checked against the source.",
  corpusNote: "Answers come only from the AI SDK Core docs, version 7.0.114.",
  // {n} is RATE_LIMIT_PER_HOUR, pinned to 20 in playwright.config.ts.
  rateNote: "20 messages/hour per visitor; regenerations count",
  prompts: PROMPTS_EN,
  newChat: "New chat",
  send: "Send message",
  stop: "Stop generating",
};
const UI_PT: UiStrings = {
  title: "Pergunte à documentação do AI SDK Core",
  subtitle: "Cada resposta cita o trecho que usou, e cada citação é conferida com a fonte.",
  corpusNote: "As respostas vêm só da documentação do AI SDK Core, versão 7.0.114.",
  rateNote: "20 mensagens/hora por visitante; regenerações contam",
  prompts: PROMPTS_PT,
  newChat: "Nova conversa",
  send: "Enviar mensagem",
  stop: "Parar geração",
};

// The fields of a POST /api/chat body these tests read (spec §5 step 3, S-17).
type ChatRequestBody = {
  id: string;
  locale?: unknown;
  message: { role: string; parts: { type: string; text?: string }[] };
};

const header = (page: Page) => page.locator("header[data-model]");
const footer = (page: Page) => page.locator("footer");
// exact: a non-exact "EN" also matches "Send message".
const switchButton = (page: Page, name: "EN" | "PT") =>
  page.getByRole("button", { name, exact: true });
const newChatButton = (page: Page, name: string) =>
  header(page).getByRole("button", { name, exact: true });
const composer = (page: Page) => page.getByRole("textbox");
const conversation = (page: Page) => page.getByRole("log");
// The scroll container is the parent of the role="log" list, as in chat.spec.ts.
const scroller = (page: Page) => conversation(page).locator("xpath=..");
const userBubbles = (page: Page) => page.locator('[data-message-role="user"]');
const assistantBubbles = (page: Page) => page.locator('[data-message-role="assistant"]');
// The answer text is the first child of an assistant bubble, as in chat.spec.ts.
const answerText = (page: Page) => assistantBubbles(page).locator(":scope > div").first();
// The error banner. Next.js's route announcer also has role="alert", so the banner is
// located by its data-slot, as in chat.spec.ts.
const banner = (page: Page) => page.locator('[data-slot="alert"]');
// The sr-only live region the chat announces the end of a response through.
const statusRegion = (page: Page) => page.locator('div[role="status"].sr-only');

async function sendPortuguese(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
}

function isChatPost(request: Request): boolean {
  return request.method() === "POST" && new URL(request.url()).pathname === "/api/chat";
}

/** Runs `action` and returns the body of the POST /api/chat it sends. */
async function postedBody(page: Page, action: () => Promise<void>): Promise<ChatRequestBody> {
  const posted = page.waitForRequest(isChatPost);
  await action();
  return (await posted).postDataJSON() as ChatRequestBody;
}

/**
 * The fixed text of every English value that differs from its pt-BR value: the parts between
 * {placeholders} that the pt-BR value does not also contain. So sources.summary gives " of "
 * and " quotes verified", and a value equal in both gives nothing.
 */
function englishOnly(en: unknown, pt: unknown): string[] {
  if (typeof en === "string" && typeof pt === "string") {
    return en.split(/\{\w+\}/).filter((fragment) => !pt.includes(fragment));
  }
  const ptValues = pt as Record<string, unknown>;
  return Object.entries(en as Record<string, unknown>).flatMap(([key, value]) =>
    englishOnly(value, ptValues[key]),
  );
}

const ENGLISH_ONLY = englishOnly(messages.en, messages["pt-BR"]);

/**
 * The English-only strings found in the page's interface text or in any aria-label or
 * placeholder. The question and the answer are left out: they are the visitor's and the
 * model's words, and the mock answers in English (a real Portuguese answer keeps its quotes
 * in English too, R-12). So is the corpus text the page marks lang="en": headings, file names
 * and passages (spec §3).
 */
async function englishLeftovers(page: Page): Promise<string[]> {
  const texts = await page.evaluate(() => {
    const skipped = [
      "script",
      "style",
      '[data-message-role="user"]',
      '[data-message-role="assistant"] > :first-child',
      // Inside <body>: in English, <html lang="en"> would skip the whole page.
      'body [lang="en"]',
    ].join(", ");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.parentElement?.closest(skipped)) continue;
      nodes.push(node.textContent ?? "");
    }
    const attributes = (name: string) =>
      Array.from(document.querySelectorAll(`[${name}]`), (element) => element.getAttribute(name));
    return [nodes.join("\n"), ...attributes("aria-label"), ...attributes("placeholder")];
  });
  return ENGLISH_ONLY.filter((fragment) => texts.some((text) => text?.includes(fragment)));
}

async function expectNoEnglish(page: Page): Promise<void> {
  await expect.poll(() => englishLeftovers(page)).toEqual([]);
}

/**
 * Waits until the page has hydrated: the chat focuses the composer from an effect on load
 * (fine pointers only, #1 spec §2.5). The locale store is checked in the same flush of
 * effects and a change re-renders synchronously, so after this an English assertion can
 * no longer pass on the prerendered HTML alone.
 */
async function waitForHydration(page: Page): Promise<void> {
  await expect(page.getByRole("textbox")).toBeFocused();
}

async function expectPortuguese(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(switchButton(page, "PT")).toHaveAttribute("aria-pressed", "true");
  await expect(switchButton(page, "EN")).toHaveAttribute("aria-pressed", "false");
  await expect(newChatButton(page, "Nova conversa")).toBeVisible();
}

async function expectEnglish(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(switchButton(page, "EN")).toHaveAttribute("aria-pressed", "true");
  await expect(switchButton(page, "PT")).toHaveAttribute("aria-pressed", "false");
  await expect(newChatButton(page, "New chat")).toBeVisible();
}

/**
 * The empty state (spec §7): the title as the <h2>, the subtitle, the corpus note with the
 * pinned version, the four questions in order (the only buttons in <main>), and the rate note.
 */
async function expectEmptyState(page: Page, strings: UiStrings): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 2, name: strings.title, exact: true }),
  ).toBeVisible();
  for (const text of [strings.subtitle, strings.corpusNote, strings.rateNote]) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("main").getByRole("button")).toHaveText([...strings.prompts]);
}

/**
 * A phone: the 4 questions, New chat, EN and PT are at least 44 px tall (#1 spec §2.5), and the
 * page does not scroll sideways. The sizes come from CSS, so they are the same before and after
 * hydration.
 */
async function expectPhoneLayout(page: Page, strings: UiStrings): Promise<void> {
  for (const name of [...strings.prompts, strings.newChat, "EN", "PT"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box?.height, `height of "${name}"`).toBeGreaterThanOrEqual(44);
  }
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

/**
 * #1 T-22: after a conversation more than a view taller than the screen, New chat shows the
 * empty state from its title. The mock's [[slow]] answer is stopped once it is that tall.
 */
async function expectNewChatOpensAtTitle(page: Page, strings: UiStrings): Promise<void> {
  await composer(page).tap();
  await composer(page).fill(SLOW_QUESTION);
  await page.getByRole("button", { name: strings.send, exact: true }).tap();
  // The view follows the stream, so this waits until it is more than a full view down.
  await expect
    .poll(() => scroller(page).evaluate((element) => element.scrollTop - element.clientHeight), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: strings.stop, exact: true }).tap();

  await newChatButton(page, strings.newChat).tap();
  await expect(conversation(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: strings.title, exact: true }),
  ).toBeInViewport({ ratio: 1 });
}

test("1. / shows the English empty state: title, subtitle, corpus note, the four questions and the rate note", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  await expectEmptyState(page, UI_EN);
});

test("2. PT translates the empty state and the placeholder", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await switchButton(page, "PT").click();
  await expectPortuguese(page);

  await expectEmptyState(page, UI_PT);
  await expect(composer(page)).toHaveAttribute("placeholder", "Envie uma mensagem");
});

test("2. PT sweep: no English interface string on the empty state, after a Stop or under the error banner", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  // Control: in English the sweep finds the dictionary's text, placeholders and aria-labels.
  await expect
    .poll(() => englishLeftovers(page))
    .toEqual(expect.arrayContaining([UI_EN.title, "Send a message", "Language"]));

  await switchButton(page, "PT").click();
  await expectPortuguese(page);
  await expectNoEnglish(page);

  // A stopped answer: its caption, Regenerate and the stopped announcement.
  await sendPortuguese(page, SLOW_QUESTION);
  const bubble = assistantBubbles(page);
  await expect(bubble).toHaveCount(1);
  await page.getByRole("button", { name: "Parar geração", exact: true }).click();
  await expect(bubble.getByText("Interrompida", { exact: true })).toBeVisible();
  await expect(bubble.getByRole("button", { name: "Gerar novamente", exact: true })).toBeVisible();
  await expect(statusRegion(page)).toHaveText("Resposta interrompida");
  await expect(conversation(page)).toHaveAccessibleName("Conversa");
  await expect(composer(page)).toHaveAccessibleName("Mensagem");
  await expect(newChatButton(page, "Nova conversa")).toBeVisible();
  await expect(footer(page)).toContainText("Feito por");
  await expect(footer(page)).toContainText("Código no GitHub");
  await expectNoEnglish(page);

  // A failed request: the generic banner, its Retry and the failed announcement.
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 500,
      contentType: "text/plain; charset=utf-8",
      body: "Internal Server Error",
    }),
  );
  await sendPortuguese(page, "Olá");
  await expect(banner(page)).toContainText(
    "Não foi possível obter uma resposta. Verifique sua conexão e tente de novo.",
  );
  await expect(
    banner(page).getByRole("button", { name: "Tentar de novo", exact: true }),
  ).toBeVisible();
  await expect(statusRegion(page)).toHaveText("Falha na resposta");
  await expectNoEnglish(page);
});

test("PT translates the header and the footer; EN switches back", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await expectEnglish(page);

  await switchButton(page, "PT").click();
  await expectPortuguese(page);
  await expect(page.getByRole("group", { name: "Idioma", exact: true })).toBeVisible();
  // e2e runs in mock mode, so the badge is on screen.
  await expect(header(page).getByText("Modelo simulado", { exact: true })).toBeVisible();
  await expect(footer(page)).toHaveText("Feito por Felipe Rêgo · Código no GitHub");

  await switchButton(page, "EN").click();
  await expectEnglish(page);
  await expect(page.getByRole("group", { name: "Language", exact: true })).toBeVisible();
  await expect(header(page).getByText("Mock model", { exact: true })).toBeVisible();
  await expect(footer(page)).toHaveText("Built by Felipe Rêgo · Source on GitHub");
});

test("3. ?lang=pt-BR opens the page in Portuguese; the served HTML stays static English", async ({
  page,
  request,
}) => {
  await page.goto("/?lang=pt-BR");
  await expectPortuguese(page);

  const response = await request.get("/?lang=pt-BR");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('<html lang="en"');
  expect(html).toContain(UI_EN.title);
});

test("4. a choice made with the switch survives a reload, in both directions", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await switchButton(page, "PT").click();
  await expectPortuguese(page);

  await page.reload();
  await expectPortuguese(page);

  // EN replaces the stored pt-BR.
  await waitForHydration(page);
  await switchButton(page, "EN").click();
  await expectEnglish(page);

  await page.reload();
  await waitForHydration(page);
  await expectEnglish(page);
});

test("with localStorage blocked the switch still works until a reload, and ?lang=pt-BR still applies", async ({
  page,
}) => {
  // Safari's private mode, or site data disabled: every access to localStorage throws.
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await waitForHydration(page);
  await expectEnglish(page);
  await switchButton(page, "PT").click();
  await expectPortuguese(page);

  // Nothing was stored: the choice lasts until the page is reloaded.
  await page.reload();
  await waitForHydration(page);
  await expectEnglish(page);

  await page.goto("/?lang=pt-BR");
  await expectPortuguese(page);
  expect(errors).toEqual([]);
});

test("5. EN after ?lang=pt-BR removes lang from the URL and stays English on reload", async ({
  page,
}) => {
  await page.goto("/?lang=pt-BR");
  await expectPortuguese(page);
  await switchButton(page, "EN").click();
  await expectEnglish(page);
  await expect(page).toHaveURL("/");

  await page.reload();
  await waitForHydration(page);
  await expectEnglish(page);
  await expect(page).toHaveURL("/");
});

test("5. the switch removes only lang: other parameters and the hash stay", async ({ page }) => {
  await page.goto("/?utm_source=e2e&lang=pt-BR#top");
  await expectPortuguese(page);
  await switchButton(page, "EN").click();
  await expectEnglish(page);
  await expect(page).toHaveURL("/?utm_source=e2e#top");
});

test("5. removing lang keeps the page: no reload, no router request; Back then Forward reopens / in English", async ({
  page,
}) => {
  await page.goto("/?lang=pt-BR");
  await expectPortuguese(page);
  // In-scope English questions, so each answer streams for about 2 s: the mock threshold is one
  // number, so the mock gate lets them through under either interface language (spec §8).
  await composer(page).fill(PROMPTS_EN[2]);
  await composer(page).press("Enter");
  await expect(assistantBubbles(page)).toHaveCount(1);
  // aria-busy turns false once the answer has finished streaming.
  await expect(conversation(page)).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  const answer = await answerText(page).innerText();

  // A reload, or any other document load, would drop this marker.
  await page.evaluate(() => Object.assign(window, { e2eSameDocument: true }));
  const requests: URL[] = [];
  page.on("request", (request) => requests.push(new URL(request.url())));

  await switchButton(page, "EN").click();
  await expectEnglish(page);
  await expect(page).toHaveURL("/");
  await expect(userBubbles(page)).toHaveText([PROMPTS_EN[2]]);
  await expect(answerText(page)).toHaveText(answer);

  // A second answer: the chat still works, and a request the switch started has had time to
  // show up.
  await composer(page).fill(PROMPTS_EN[0]);
  await composer(page).press("Enter");
  await expect(assistantBubbles(page)).toHaveCount(2);
  await expect(conversation(page)).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  expect(await page.evaluate(() => "e2eSameDocument" in window)).toBe(true);
  // Neither a document request for / nor a Next.js router (RSC) request.
  const pageRequests = requests.filter(
    (url) => url.pathname === "/" || url.searchParams.has("_rsc"),
  );
  expect(pageRequests.map(String)).toEqual([]);

  // Back leaves the page (a new context starts on about:blank). Forward loads / as a new
  // document: English, the stored choice, since the history entry no longer holds lang.
  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL("/");
  await waitForHydration(page);
  await expectEnglish(page);
});

test("6. ?lang=pt-BR alone is not stored: / in the same context opens in English", async ({
  page,
}) => {
  await page.goto("/?lang=pt-BR");
  await expectPortuguese(page);

  await page.goto("/");
  await waitForHydration(page);
  await expectEnglish(page);
});

test("7. a 429 in Portuguese shows the pt-BR limit text, not the English body", async ({
  page,
}) => {
  await page.goto("/?lang=pt-BR");
  await expectPortuguese(page);
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 429,
      contentType: "text/plain; charset=utf-8",
      headers: { "Retry-After": "3600" },
      body: LIMIT_TEXT,
    }),
  );
  await composer(page).fill("Olá");
  await composer(page).press("Enter");
  await expect(banner(page)).toHaveText(LIMIT_TEXT_PT);
  await expect(page.getByRole("button", { name: "Tentar de novo", exact: true })).toHaveCount(0);
});

test("the limit banner follows the switch: pt-BR after PT, English again after EN, never Retry", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  // In English the client's text equals LIMIT_TEXT, so the body here differs from it.
  const serverBody = "server limit text";
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 429,
      contentType: "text/plain; charset=utf-8",
      headers: { "Retry-After": "3600" },
      body: serverBody,
    }),
  );
  await composer(page).fill("Hello");
  await composer(page).press("Enter");
  await expect(banner(page)).toHaveText(LIMIT_TEXT);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);

  await switchButton(page, "PT").click();
  await expectPortuguese(page);
  await expect(banner(page)).toHaveText(LIMIT_TEXT_PT);
  await expect(page.getByRole("button", { name: "Tentar de novo", exact: true })).toHaveCount(0);

  await switchButton(page, "EN").click();
  await expectEnglish(page);
  await expect(banner(page)).toHaveText(LIMIT_TEXT);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
});

test("8. a suggested question posts its exact text and the locale: en, then pt-BR after PT; Regenerate sends pt-BR too", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  // English first: a locale fixed at load, rather than read for each request, fails below.
  const english = await postedBody(page, () =>
    page.getByRole("button", { name: PROMPTS_EN[0], exact: true }).click(),
  );
  expect(english.locale).toBe("en");
  await newChatButton(page, "New chat").click();

  await switchButton(page, "PT").click();
  await expectPortuguese(page);
  const prompt = PROMPTS_PT[0];
  const sent = await postedBody(page, () =>
    page.getByRole("button", { name: prompt, exact: true }).click(),
  );
  // Only the latest message, the chat id and the locale (S-17).
  expect(Object.keys(sent).sort()).toEqual(["id", "locale", "message"]);
  expect(sent.message.role).toBe("user");
  expect(sent.message.parts).toEqual([{ type: "text", text: prompt }]);
  expect(sent.locale).toBe("pt-BR");

  // Regenerate shows once the answer, or the mock gate's refusal (spec §8), is complete.
  const regenerate = assistantBubbles(page).getByRole("button", {
    name: "Gerar novamente",
    exact: true,
  });
  await expect(regenerate).toBeVisible({ timeout: 20_000 });
  const regenerated = await postedBody(page, () => regenerate.click());
  expect(regenerated.message.parts).toEqual([{ type: "text", text: prompt }]);
  expect(regenerated.locale).toBe("pt-BR");
});

test("PT while an answer streams renames Stop; the stopped request sent en, its Regenerate sends pt-BR", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  const english = await postedBody(page, async () => {
    await composer(page).fill(SLOW_QUESTION);
    await composer(page).press("Enter");
  });
  // Sent before the switch.
  expect(english.locale).toBe("en");
  // The bubble shows once text has arrived; aria-busy stays true while the answer streams.
  const bubble = assistantBubbles(page);
  await expect(bubble).toHaveCount(1);
  await expect(conversation(page)).toHaveAttribute("aria-busy", "true");

  await switchButton(page, "PT").click();
  await expectPortuguese(page);
  await page.getByRole("button", { name: "Parar geração", exact: true }).click();
  await expect(bubble.getByText("Interrompida", { exact: true })).toBeVisible();

  const regenerated = await postedBody(page, () =>
    bubble.getByRole("button", { name: "Gerar novamente", exact: true }).click(),
  );
  expect(regenerated.locale).toBe("pt-BR");
});

test("the out-of-scope question gets the gate's refusal in the interface language (S-09)", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: PROMPTS_EN[3], exact: true }).click();
  await expect(answerText(page)).toHaveText(REFUSAL_EN);
  await expect(assistantBubbles(page)).toHaveAttribute("data-refusal", "gate");

  await switchButton(page, "PT").click();
  await expectPortuguese(page);
  await newChatButton(page, "Nova conversa").click();
  await page.getByRole("button", { name: PROMPTS_PT[3], exact: true }).click();
  await expect(answerText(page)).toHaveText(REFUSAL_PT);
  await expect(assistantBubbles(page)).toHaveAttribute("data-refusal", "gate");
  await expectNoEnglish(page);
});

test("a Portuguese question under the English interface: the gate refuses in English (S-09); one past the gate gets verified English quotes", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  const ask = (text: string) =>
    postedBody(page, async () => {
      await composer(page).fill(text);
      await composer(page).press("Enter");
    });

  // The route cannot tell the question's language without a model call, so the gate refuses in
  // the interface language (spec §8, S-09).
  const refused = await ask(PROMPTS_PT[3]);
  expect(refused.locale).toBe("en");
  await expect(answerText(page)).toHaveText(REFUSAL_EN);
  await expect(assistantBubbles(page)).toHaveAttribute("data-refusal", "gate");

  // A Portuguese question the mock gate lets through (tests/mock-threshold.test.ts pins it). The
  // mock answers in English; a real model answers in the question's language (spec §6.1 rule 3,
  // checked by hand in production), and either way its quotes stay English and verify (R-12).
  await newChatButton(page, "New chat").click();
  const answered = await ask(PROMPTS_PT[2]);
  expect(answered.locale).toBe("en");
  expect(answered.message.parts).toEqual([{ type: "text", text: PROMPTS_PT[2] }]);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(userBubbles(page)).toHaveText([PROMPTS_PT[2]]);
  const bubble = assistantBubbles(page);
  await expect(bubble).not.toHaveAttribute("data-refusal");
  await expect(bubble.locator('[data-citation-verified="true"]')).toHaveCount(2);
  await expect(bubble.locator('[data-citation-verified="false"]')).toHaveCount(0);
  await expect(
    bubble.getByRole("region", { name: "Sources", exact: true }).getByRole("listitem"),
  ).toContainText(["1 of 1 quotes verified", "1 of 1 quotes verified"]);
});

test("PT: the [n] buttons, the Sources list and an open popover are in Portuguese", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  await switchButton(page, "PT").click();
  await expectPortuguese(page);

  // An English in-scope question: in mock mode the gate may refuse a Portuguese one (spec §8).
  await sendPortuguese(page, PROMPTS_EN[0]);
  await expect(page.getByRole("button", { name: "Enviar mensagem", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const bubble = assistantBubbles(page);
  const sources = bubble.getByRole("region", { name: "Fontes", exact: true });
  await expect(sources.getByRole("heading", { name: "Fontes", exact: true })).toBeVisible();
  await expect(sources.getByRole("listitem")).toContainText([
    "1 de 1 citações verificadas",
    "1 de 1 citações verificadas",
  ]);

  await bubble.getByRole("button", { name: "Fonte 1", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Citação verificada", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Ver fonte no GitHub", exact: true }),
  ).toBeVisible();
  await expectNoEnglish(page);
});

test("PT: the badges of citations that are not verified", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await switchButton(page, "PT").click();
  await expectPortuguese(page);

  const cases = [
    { trigger: NOT_FOUND_TRIGGER, name: "Fonte 1", badge: "Citação não encontrada na fonte" },
    { trigger: UNKNOWN_SOURCE_TRIGGER, name: "Fonte 6", badge: "Fonte inexistente" },
    {
      trigger: MALFORMED_TRIGGER,
      name: "Citação fora do formato esperado",
      badge: "Citação fora do formato esperado",
    },
  ];
  for (const [i, { trigger, name, badge }] of cases.entries()) {
    await sendPortuguese(page, `${PROMPTS_EN[2]} ${trigger}`);
    await expect(assistantBubbles(page)).toHaveCount(i + 1, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Enviar mensagem", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const failed = assistantBubbles(page).last().locator('[data-citation-verified="false"]');
    await expect(failed).toHaveAccessibleName(name);
    await failed.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(badge, { exact: true })).toBeVisible();
    await expectNoEnglish(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await expect(
    assistantBubbles(page).first().getByRole("region", { name: "Fontes" }).getByRole("listitem"),
  ).toContainText(["1 de 2 citações verificadas", "1 de 1 citações verificadas"]);
});

test.describe("9. a phone at 375×812 with touch", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("9. 44 px targets, no sideways scroll and New chat back at the title, in English and after tapping PT", async ({
    page,
  }) => {
    await page.goto("/");
    const isCoarsePointer = await page.evaluate(
      () => window.matchMedia("(pointer: coarse)").matches,
    );
    expect(isCoarsePointer).toBe(true);
    await expectPhoneLayout(page, UI_EN);
    await expectNewChatOpensAtTitle(page, UI_EN);

    await switchButton(page, "PT").tap();
    await expectPortuguese(page);
    await expectPhoneLayout(page, UI_PT);
    await expectNewChatOpensAtTitle(page, UI_PT);
  });
});
