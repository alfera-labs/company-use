import { cn } from '@coworker/ui/lib/utils';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type ChatWorkingIndicator,
  chat_working_indicators,
} from '@/components/app/chat_working_indicators';

export const Route = createFileRoute('/loading-indicators')({
  component: LoadingIndicatorsPage,
});

function LoadingIndicatorsPage() {
  const [with_text, set_with_text] = useState(true);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-6 py-16">
        <header className="border-b border-border pb-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Internal · Design review
          </p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight">Chat working indicators</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-6 text-muted-foreground">
            Eleven candidates for the indicator shown while your Alfera coworker is streaming a
            reply. Whichever we pick stays visible for the whole active run — it no longer blinks
            out between a tool finishing and the next token. Each specimen is rendered at real size,
            on the real message row, in light and dark.
          </p>
          <p className="mt-3 max-w-2xl text-[15px] leading-6 text-muted-foreground">
            The first six all say "something is happening". The five marked{' '}
            <span className="font-medium text-foreground">Round 2</span> answer the harder question
            behind the complaint — "it's not clear when it is and is not working" — which is about
            certainty rather than decoration. Elapsed time is the strongest answer available: a
            number that ticks every second cannot be a frozen tab, and it also tells you whether
            this has been running for four seconds or four minutes.
          </p>

          <label className="mt-6 inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              checked={with_text}
              className="size-4 accent-primary"
              type="checkbox"
              onChange={(event) => set_with_text(event.target.checked)}
            />
            Show a half-streamed reply above the indicator
          </label>
        </header>

        <ol className="divide-y divide-border">
          {chat_working_indicators.map((indicator, index) => (
            <IndicatorRow
              key={indicator.id}
              index={index + 1}
              indicator={indicator}
              withText={with_text}
            />
          ))}
        </ol>
      </div>
    </main>
  );
}

function IndicatorRow({
  index,
  indicator,
  withText,
}: {
  index: number;
  indicator: ChatWorkingIndicator;
  withText: boolean;
}) {
  return (
    <li className="grid gap-6 py-10 md:grid-cols-[220px_1fr]">
      <div>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm text-muted-foreground">
            {index.toString().padStart(2, '0')}
          </span>
          <h2 className="text-lg font-medium">{indicator.name}</h2>
        </div>
        {indicator.note ? (
          <span className="mt-2 inline-flex rounded-full border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {indicator.note}
          </span>
        ) : null}
        <p className="mt-3 text-sm leading-5 text-muted-foreground">{indicator.communicates}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Specimen indicator={indicator} theme="light" withText={withText} />
        <Specimen indicator={indicator} theme="dark" withText={withText} />
      </div>
    </li>
  );
}

function Specimen({
  indicator,
  theme,
  withText,
}: {
  indicator: ChatWorkingIndicator;
  theme: 'light' | 'dark';
  withText: boolean;
}) {
  return (
    <div
      className={cn(
        theme === 'dark' ? 'dark' : '',
        'overflow-hidden rounded-3xl border border-border bg-background',
      )}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {theme}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-5">
        {withText ? (
          <>
            <div className="flex justify-end">
              <span className="max-w-[80%] rounded-2xl bg-accent px-4 py-2 text-sm leading-5 text-foreground">
                Summarize last week's support tickets.
              </span>
            </div>
            <p className="text-[15px] leading-6 text-foreground">
              Sure — I pulled 128 tickets from last week. The top theme was billing, with
            </p>
          </>
        ) : null}

        <div className="inline-flex h-6 w-fit items-center text-muted-foreground">
          {indicator.render()}
        </div>
      </div>
    </div>
  );
}
