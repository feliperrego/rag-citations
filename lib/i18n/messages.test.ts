import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "./locale";
import { format, messages, OUT_OF_SCOPE_PROMPT } from "./messages";

// The approved strings, as literals, so a rewording fails here instead of moving with the
// dictionary. #2's keys are verbatim from spec §7.1 (S-03, R-15, R-17). The keys reused from
// #1's approved dictionary keep #1's text (spec §7.1): composer, list (without ttft), chat,
// errors, status, header, footer and empty.rateNote. `{name}` stands where a value goes.
const APPROVED: Record<Locale, unknown> = {
  en: {
    empty: {
      title: "Ask the AI SDK Core docs",
      subtitle:
        "Every answer cites the passage it used, and each quote is checked against the source.",
      corpusNote: "Answers come only from the AI SDK Core docs, version {version}.",
      rateNote: "{n} messages/hour per visitor; regenerations count",
    },
    prompts: [
      "How do I embed many values in parallel?",
      "How can I test my code without calling a real model?",
      "How do I rerank search results?",
      "How do I enable dark mode in Tailwind CSS?",
    ],
    sources: { title: "Sources", summary: "{verified} of {total} quotes verified" },
    citation: {
      button: "Source {n}",
      verified: "Quote verified",
      notFound: "Quote not found in source",
      malformed: "Citation not in the expected format",
      unknownSource: "No such source",
      viewSource: "View source on GitHub",
    },
    refusal: "I don't know. The AI SDK Core docs I search don't cover that.",
    header: { mockBadge: "Mock model", newChat: "New chat", language: "Language" },
    composer: {
      label: "Message",
      placeholder: "Send a message",
      send: "Send message",
      stop: "Stop generating",
    },
    list: {
      label: "Conversation",
      stopped: "Stopped",
      cutOff: "Cut at demo length limit",
      regenerate: "Regenerate",
      stoppedBefore: "Stopped before a response ·",
    },
    chat: { jump: "Jump to latest", retry: "Retry" },
    errors: {
      generic: "Couldn't get a response. Check your connection and try again.",
      limit: "Demo limit reached: {n} messages per hour. Try again later.",
    },
    status: {
      complete: "Response complete",
      stopped: "Response stopped",
      failed: "Response failed",
    },
    footer: { builtBy: "Built by", source: "Source on GitHub" },
  },
  "pt-BR": {
    empty: {
      title: "Pergunte à documentação do AI SDK Core",
      subtitle: "Cada resposta cita o trecho que usou, e cada citação é conferida com a fonte.",
      corpusNote: "As respostas vêm só da documentação do AI SDK Core, versão {version}.",
      rateNote: "{n} mensagens/hora por visitante; regenerações contam",
    },
    prompts: [
      "Como gerar embeddings de vários textos em paralelo?",
      "Como testar meu código sem chamar um modelo de verdade?",
      "Como reordenar resultados de busca (rerank)?",
      "Como ativo o modo escuro no Tailwind CSS?",
    ],
    sources: { title: "Fontes", summary: "{verified} de {total} citações verificadas" },
    citation: {
      button: "Fonte {n}",
      verified: "Citação verificada",
      notFound: "Citação não encontrada na fonte",
      malformed: "Citação fora do formato esperado",
      unknownSource: "Fonte inexistente",
      viewSource: "Ver fonte no GitHub",
    },
    refusal: "Não sei. A documentação do AI SDK Core que eu consulto não cobre isso.",
    header: { mockBadge: "Modelo simulado", newChat: "Nova conversa", language: "Idioma" },
    composer: {
      label: "Mensagem",
      placeholder: "Envie uma mensagem",
      send: "Enviar mensagem",
      stop: "Parar geração",
    },
    list: {
      label: "Conversa",
      stopped: "Interrompida",
      cutOff: "Cortada no limite de tamanho da demo",
      regenerate: "Gerar novamente",
      stoppedBefore: "Interrompida antes da resposta ·",
    },
    chat: { jump: "Ir para o fim", retry: "Tentar de novo" },
    errors: {
      generic: "Não foi possível obter uma resposta. Verifique sua conexão e tente de novo.",
      limit: "Limite da demo atingido: {n} mensagens por hora. Tente mais tarde.",
    },
    status: {
      complete: "Resposta concluída",
      stopped: "Resposta interrompida",
      failed: "Falha na resposta",
    },
    footer: { builtBy: "Feito por", source: "Código no GitHub" },
  },
};

/** Every string of a dictionary, keyed by its path, e.g. "prompts.3". */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  return Object.entries(value as object).flatMap(([key, child]) =>
    leaves(child, path === "" ? key : `${path}.${key}`),
  );
}

/** The distinct `{name}` placeholders of a string, sorted. */
function placeholders(text: string): string[] {
  return [...new Set(text.match(/\{\w+\}/g))].sort();
}

describe("messages", () => {
  it.each(LOCALES)("has no empty value in %s", (locale) => {
    for (const [path, text] of leaves(messages[locale])) {
      expect(text.trim(), path).not.toBe("");
    }
  });

  it("has the same keys in both locales", () => {
    const keys = (locale: Locale) => leaves(messages[locale]).map(([path]) => path);
    expect(keys("pt-BR")).toEqual(keys("en"));
  });

  it("uses the same placeholders in both locales", () => {
    const pt = new Map(leaves(messages["pt-BR"]));
    for (const [path, text] of leaves(messages.en)) {
      expect(placeholders(pt.get(path) ?? ""), path).toEqual(placeholders(text));
    }
  });

  it.each(LOCALES)("holds exactly the approved %s strings", (locale) => {
    expect(messages[locale]).toEqual(APPROVED[locale]);
  });

  it.each(LOCALES)("puts the out-of-scope prompt last in %s (R-15)", (locale) => {
    expect(OUT_OF_SCOPE_PROMPT).toBe(messages[locale].prompts.length - 1);
    expect(messages[locale].prompts[OUT_OF_SCOPE_PROMPT]).toMatch(/Tailwind CSS\?$/);
  });
});

describe("format", () => {
  it("fills every {name} placeholder", () => {
    expect(
      format("Answers come only from the docs, version {version}.", { version: "7.0.114" }),
    ).toBe("Answers come only from the docs, version 7.0.114.");
    expect(format("{verified} of {total} quotes verified", { verified: 1, total: 2 })).toBe(
      "1 of 2 quotes verified",
    );
    expect(format("{a} and {b}, then {a}", { a: 1, b: "two" })).toBe("1 and two, then 1");
  });

  it("leaves other text alone", () => {
    expect(format("Stopped before a response ·", { n: 1 })).toBe("Stopped before a response ·");
    expect(format("{m} and { n } stay", { n: 1 })).toBe("{m} and { n } stay");
    // Values go in verbatim: no $ patterns, and no second pass over inserted text.
    expect(format("{n}", { n: "$& {n}" })).toBe("$& {n}");
  });
});
