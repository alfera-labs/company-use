import { cn } from '@coworker/ui/lib/utils';
import { ChevronDown, Globe2, LoaderCircle, Search } from 'lucide-react';
import { useState } from 'react';
import type { ProjectedChatToolPart } from '@/components/app/chat_stream_projection';
import {
  is_running_state,
  read_web_search_group,
  type WebSearchCallView,
  type WebSearchResult,
} from '@/components/app/web_search_tool_model';

export type WebSearchToolCall = { part: ProjectedChatToolPart; state: string };

export function WebSearchTool({
  calls,
  showFullTraces = false,
}: {
  calls: WebSearchToolCall[];
  showFullTraces?: boolean;
}) {
  const [show_details, set_show_details] = useState(false);
  const view = read_web_search_group(
    calls.map(({ part, state }) => ({
      call_id: part.canonicalId ?? part.toolCallId,
      state,
      ...(part.input === undefined ? {} : { input: part.input }),
      ...(part.output === undefined ? {} : { output: part.output }),
      ...(part.outputText === undefined ? {} : { outputText: part.outputText }),
      ...(part.errorText === undefined ? {} : { errorText: part.errorText }),
    })),
  );
  const is_running = view.calls.some((call) => !call.issue && is_running_state(call.state));
  const waiting_count = view.calls.filter((call) => call.state === 'awaiting_approval').length;
  const details_open = showFullTraces || show_details;
  const title = group_status_label(is_running, waiting_count, view.calls, view.results.length);
  const preview = latest_query(view.calls);
  const counts = [
    view.results.length > 0
      ? `${view.results.length} ${plural(view.results.length, 'source')}`
      : '',
    calls.length > 1 ? `${calls.length} searches` : '',
    view.issue_count > 0 ? `${view.issue_count} ${plural(view.issue_count, 'issue')}` : '',
    waiting_count > 0 ? `${waiting_count} waiting` : '',
  ].filter(Boolean);
  const mobile_count =
    waiting_count > 0
      ? `${waiting_count} waiting`
      : view.issue_count > 0
        ? `${view.issue_count} ${plural(view.issue_count, 'issue')}`
        : view.results.length > 0
          ? `${view.results.length} ${plural(view.results.length, 'source')}`
          : '';

  return (
    <section className="w-full overflow-hidden">
      <button
        aria-expanded={details_open}
        className="flex min-h-7 w-full items-center gap-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={() => set_show_details((current) => !current)}
      >
        {is_running ? (
          <LoaderCircle
            aria-hidden
            className="chat-research-spinner size-3 shrink-0 text-muted-foreground"
          />
        ) : (
          <Search aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span
          aria-live="polite"
          className="max-w-[48%] shrink-0 truncate text-[13px] font-medium text-foreground"
        >
          {title}
        </span>
        <span
          className="chat-research-fade min-w-0 flex-1 truncate text-[12px] text-muted-foreground"
          key={preview}
        >
          {preview ? `· ${preview}` : ''}
        </span>
        {counts.length > 0 ? (
          <span className="hidden shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground sm:inline">
            {counts.join(' · ')}
          </span>
        ) : null}
        {mobile_count ? (
          <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground sm:hidden">
            {mobile_count}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            details_open && 'rotate-180',
          )}
        />
      </button>
      {is_running && view.results.length > 0 ? (
        <LiveSources results={view.results.slice(0, 3)} />
      ) : null}
      {details_open ? (
        <div className="ml-5 max-h-96 overflow-y-auto border-l border-border/50 pl-3">
          <SearchDetails calls={view.calls} />
          {view.results.length > 0 ? (
            <div className="space-y-1 py-2">
              {view.results.map((result) => (
                <SearchResultCard key={result.url} result={result} />
              ))}
            </div>
          ) : is_running ? (
            <SearchSkeleton />
          ) : (
            <SearchMessage>{empty_group_message(waiting_count, view.calls)}</SearchMessage>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SearchDetails({ calls }: { calls: WebSearchCallView[] }) {
  return (
    <div className="space-y-1 py-2">
      {calls.map((call) => (
        <div
          className="flex min-w-0 flex-col items-start gap-0.5 text-[12px] sm:flex-row sm:justify-between sm:gap-3"
          key={call.call_id}
        >
          <span className="min-w-0 break-words text-foreground">{call.query || 'Web search'}</span>
          <span className="shrink-0 text-muted-foreground">{call_status_label(call)}</span>
        </div>
      ))}
    </div>
  );
}

function SearchResultCard({ result }: { result: WebSearchResult }) {
  return (
    <a
      className="group/source flex min-w-0 items-center gap-2 py-1 text-[12px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      href={result.url}
      rel="noreferrer"
      target="_blank"
    >
      <SourceIcon result={result} />
      <span className="max-w-24 shrink-0 truncate text-[11px] text-muted-foreground">
        {result.domain}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground group-hover/source:text-brand-ink">
        {result.title}
      </span>
    </a>
  );
}

function LiveSources({ results }: { results: WebSearchResult[] }) {
  return (
    <div className="ml-5 space-y-0.5 pb-1 pl-3">
      {results.map((result, index) => (
        <div
          className="chat-research-source-fade flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
          key={result.url}
          style={{ animationDelay: `${Math.min(index * 40, 120)}ms` }}
        >
          <SourceIcon result={result} />
          <span className="max-w-24 shrink-0 truncate">{result.domain}</span>
          <span className="min-w-0 truncate">· {result.title}</span>
        </div>
      ))}
    </div>
  );
}

function SourceIcon({ result }: { result: WebSearchResult }) {
  const [loaded, set_loaded] = useState(false);
  return (
    <span className="relative size-3 shrink-0">
      <Globe2 aria-hidden="true" className="absolute inset-0 size-3" />
      <img
        alt=""
        className={cn('absolute inset-0 size-3 rounded-lg', loaded ? 'opacity-100' : 'opacity-0')}
        src={result.favicon_url}
        onError={() => set_loaded(false)}
        onLoad={() => set_loaded(true)}
      />
    </span>
  );
}

function SearchSkeleton() {
  return (
    <div aria-live="polite" className="py-2 text-[12px] text-muted-foreground" role="status">
      Searching for sources…
    </div>
  );
}

function SearchMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[12px] text-muted-foreground">{children}</p>;
}

function group_status_label(
  is_running: boolean,
  waiting_count: number,
  calls: WebSearchCallView[],
  result_count: number,
) {
  if (is_running) return 'Searching the web';
  if (waiting_count > 0 && result_count === 0) return 'Search waiting';
  if (result_count > 0) return 'Searched the web';
  if (calls.every((call) => call.issue === 'denied')) return 'Search not allowed';
  if (calls.every((call) => call.issue === 'stopped')) return 'Search stopped';
  if (calls.some((call) => call.issue === 'failed')) return 'Search failed';
  if (calls.every((call) => call.issue === 'unavailable')) return 'Web search unavailable';
  if (calls.some((call) => call.issue === 'unreadable')) return 'Search results unavailable';
  if (calls.every((call) => call.issue)) return 'Search incomplete';
  return 'Searched the web';
}

function call_status_label(call: WebSearchCallView) {
  if (!call.issue && is_running_state(call.state)) return 'Searching';
  if (call.state === 'awaiting_approval') return 'Waiting for approval';
  if (call.issue === 'denied') return 'Not allowed';
  if (call.issue === 'stopped') return 'Stopped';
  if (call.issue === 'failed') return 'Failed';
  if (call.issue === 'unavailable') return 'Unavailable';
  if (call.issue === 'unreadable') return 'Results unavailable';
  return `${call.results.length} ${plural(call.results.length, 'source')}`;
}

function empty_group_message(waiting_count: number, calls: WebSearchCallView[]) {
  if (waiting_count > 0) return 'The web search waits for your approval.';
  if (calls.every((call) => call.issue === 'denied')) return 'The web search was not allowed.';
  if (calls.every((call) => call.issue === 'stopped'))
    return 'The web search stopped before it finished.';
  if (calls.some((call) => call.issue === 'failed')) return 'The web search failed.';
  if (calls.every((call) => call.issue === 'unavailable'))
    return 'The web search service is unavailable.';
  if (calls.some((call) => call.issue === 'unreadable'))
    return 'Search results could not be displayed.';
  if (calls.some((call) => call.issue)) return 'No readable web sources were returned.';
  return 'No web sources were found.';
}

function latest_query(calls: WebSearchCallView[]) {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call && !call.issue && is_running_state(call.state) && call.query) return call.query;
  }
  return calls.at(-1)?.query ?? '';
}

function plural(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}
