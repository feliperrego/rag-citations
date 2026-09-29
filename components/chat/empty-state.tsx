import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/i18n/messages";
import { CORPUS_VERSION } from "@/lib/rag/config";

type EmptyStateProps = {
  /** RATE_LIMIT_PER_HOUR from lib/rate-limit.ts, so the UI never states a wrong limit. */
  rateLimitPerHour: number;
  /** Sends the question immediately. */
  onPrompt: (text: string) => void;
};

/**
 * What a new chat shows (spec §7), in the selected language: the title, the subtitle, the note
 * that answers come only from the pinned docs version, and the four suggested questions (R-15),
 * three the docs answer and one they do not. A button sends the text it shows.
 */
export function EmptyState({ rateLimitPerHour, onPrompt }: EmptyStateProps) {
  const { t } = useLocale();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 px-4 py-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{t.empty.title}</h2>
        <p className="text-muted-foreground">{t.empty.subtitle}</p>
        <p className="text-sm text-muted-foreground">
          {format(t.empty.corpusNote, { version: CORPUS_VERSION })}
        </p>
      </div>
      {/* One column below sm, two from sm up (#1 delta spec §5). */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {t.prompts.map((prompt) => (
          <Button
            key={prompt}
            variant="outline"
            className="h-auto min-h-11 justify-start px-3 py-2 text-left whitespace-normal"
            onClick={() => onPrompt(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {format(t.empty.rateNote, { n: rateLimitPerHour })}
      </p>
    </div>
  );
}
