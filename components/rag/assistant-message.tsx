import { Fragment, useMemo, type ReactNode } from "react";
import { Citation } from "@/components/rag/citation";
import { InlineCode } from "@/components/rag/inline-code";
import { SourcesList } from "@/components/rag/sources-list";
import { messageText } from "@/lib/chat/ui";
import { createAnswerChecker } from "@/lib/rag/answer";
import { messageSources, type RagUIMessage } from "@/lib/rag/message";
import { refusalOf } from "@/lib/rag/refusal";

type AssistantMessageProps = {
  message: RagUIMessage;
  /** The message is still streaming: an unfinished marker stays hidden (R-09). */
  streaming: boolean;
  /** The caption row under the answer (Stopped, Cut, Regenerate). */
  children?: ReactNode;
};

/**
 * One answer (spec §7): its plain text with <code> names and [n] buttons, then the Sources list,
 * then the caption row. A refusal is marked with data-refusal and shows no Sources (S-24).
 */
export function AssistantMessage({ message, streaming, children }: AssistantMessageProps) {
  const text = messageText(message);
  const sources = messageSources(message);
  // One checker per data-sources part, so each marker is verified once while the text streams.
  const check = useMemo(() => createAnswerChecker(sources), [sources]);
  const { parts, cited } = useMemo(() => check(text, { streaming }), [check, text, streaming]);
  const { metadata } = message;
  const refusal = useMemo(
    () => refusalOf({ metadata, text }, { streaming }),
    [metadata, text, streaming],
  );

  return (
    <div
      data-message-role="assistant"
      data-refusal={refusal ?? undefined}
      className="flex flex-col gap-2"
    >
      {/* The answer is re-parsed from the accumulated text at every chunk (spec §6.2). */}
      <div className="whitespace-pre-wrap wrap-anywhere">
        {parts.map((part, i) =>
          part.type === "text" ? (
            <Fragment key={i}>{part.text}</Fragment>
          ) : part.type === "code" ? (
            <InlineCode key={i}>{part.text}</InlineCode>
          ) : (
            <Citation key={i} part={part} />
          ),
        )}
      </div>
      {refusal === null && cited.length > 0 && <SourcesList cited={cited} />}
      {children}
    </div>
  );
}
