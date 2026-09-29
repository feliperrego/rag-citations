import type { Locale } from "./locale";

/** The four suggested questions: three the docs answer, then one they do not (R-15, S-02). */
type Prompts = readonly [string, string, string, string];

/** One locale's strings (spec §7.1). `{name}` marks where format() inserts a value. */
export type Messages = {
  empty: { title: string; subtitle: string; corpusNote: string; rateNote: string };
  /** Each button sends its text as the question (#1 D-S-02). */
  prompts: Prompts;
  sources: { title: string; summary: string };
  citation: {
    button: string;
    verified: string;
    notFound: string;
    malformed: string;
    unknownSource: string;
    viewSource: string;
  };
  /** The fixed "I don't know" sentence (R-17): the gate's text and the model's (spec §6.1). */
  refusal: string;
  header: { mockBadge: string; newChat: string; language: string };
  composer: { label: string; placeholder: string; send: string; stop: string };
  list: {
    label: string;
    stopped: string;
    cutOff: string;
    regenerate: string;
    /** Ends with the middle dot; the component adds a space before Regenerate. */
    stoppedBefore: string;
  };
  chat: { jump: string; retry: string };
  errors: { generic: string; limit: string };
  status: { complete: string; stopped: string; failed: string };
  footer: { builtBy: string; source: string };
};

/** The index of the out-of-scope question in `prompts` (spec §7.1). */
export const OUT_OF_SCOPE_PROMPT = 3;

/**
 * Every visible and accessible interface string, in English and pt-BR (spec §7.1, R-21). The
 * keys reused from #1 keep #1's approved text. Pure and client-safe; the route, the scripts and
 * the tests read the suggested questions and the refusal sentences from here too.
 */
export const messages: Record<Locale, Messages> = {
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

/**
 * Fills `{name}` placeholders from `values`, in one pass; values go in verbatim.
 * Other text, including a placeholder with no value, is left as it is.
 */
export function format(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
