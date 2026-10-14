import { cn } from '@coworker/ui/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { InternalToolContent } from '@/components/app/internal_tool_content';
import { internal_tool_family_metadata } from '@/components/app/internal_tool_registry';
import {
  type InternalToolCall,
  type InternalToolView,
  read_internal_tool_call_state,
  read_internal_tool_view,
} from '@/components/app/internal_tool_view';

type CallView = {
  call: InternalToolCall;
  state: string;
  view: ReturnType<typeof read_internal_tool_view>;
};

export function InternalToolPanel({
  calls,
  onArtifactOpen,
  showFullTraces = false,
}: {
  calls: InternalToolCall[];
  onArtifactOpen?: (file_id: string) => void;
  showFullTraces?: boolean;
}) {
  const [show_details, set_show_details] = useState(false);
  const call_views = calls.map((call) => {
    const view = read_internal_tool_view(call);
    return { call, state: read_internal_tool_call_state(call, view), view };
  });
  const metadata = internal_tool_family_metadata[calls[0]?.definition.family ?? 'assistant'];
  const is_browser = calls[0]?.definition.family === 'browser';
  const Icon = metadata.icon;
  const states = call_views.map(({ state }) => state);
  const issue_count = states.filter((state) => !['complete', 'running'].includes(state)).length;
  const notice_count = call_views.filter(({ view }) => view?.notice).length;
  const details_open = showFullTraces || show_details;
  const preview = compact_preview(call_views);
  const state = group_state(states);
  const title = status_title(state, metadata.title);

  return (
    <section
      className={cn(
        'w-full overflow-hidden',
        is_browser && 'rounded-2xl border border-border/60 bg-raised shadow-sm',
      )}
    >
      <button
        aria-expanded={details_open}
        className={cn(
          'flex w-full items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          is_browser ? 'min-h-9 px-3 py-2 hover:bg-muted/30' : 'min-h-7 py-1',
        )}
        type="button"
        onClick={() => set_show_details((current) => !current)}
      >
        <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        <span
          aria-live="polite"
          className="min-w-0 max-w-[45%] truncate text-[13px] font-medium text-foreground"
        >
          {state === 'running' ? (
            <Shimmer as="span" duration={1.6}>
              {title}
            </Shimmer>
          ) : (
            title
          )}
        </span>
        {preview ? (
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            · {preview}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {calls.length > 1 || issue_count > 0 || notice_count > 0 ? (
          <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
            {[
              calls.length > 1 ? `${calls.length} actions` : '',
              issue_count > 0 ? `${issue_count} ${issue_count === 1 ? 'issue' : 'issues'}` : '',
              notice_count > 0
                ? `${notice_count} ${notice_count === 1 ? 'notice' : 'notices'}`
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
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
      {details_open ? (
        <CallDetails calls={call_views} {...(onArtifactOpen ? { onArtifactOpen } : {})} />
      ) : null}
    </section>
  );
}

function CallDetails({
  calls,
  onArtifactOpen,
}: {
  calls: CallView[];
  onArtifactOpen?: (file_id: string) => void;
}) {
  return (
    <div className="ml-5 max-h-96 space-y-3 overflow-y-auto border-l border-border/50 py-1.5 pl-3">
      {calls.map(({ call, state, view }) => (
        <div className="space-y-2" key={call.call_id}>
          <div className="flex items-start justify-between gap-3 text-[12px]">
            <span className="font-medium text-foreground">
              {view?.summary || call.definition.title}
            </span>
            {state === 'complete' ? null : (
              <span className="shrink-0 text-muted-foreground">{state_label(state)}</span>
            )}
          </div>
          {view ? (
            <InternalToolContent
              view={without_summary(view)}
              {...(onArtifactOpen ? { onArtifactOpen } : {})}
            />
          ) : null}
          {state === 'failed' && call.error_text ? (
            <p className="break-words text-[12px] text-destructive">{call.error_text}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function without_summary(view: InternalToolView): InternalToolView {
  const { summary: _summary, ...body } = view;
  return body;
}

function compact_preview(calls: CallView[]) {
  const first = calls.find(({ view }) => view)?.view;
  const notice = calls.find(({ view }) => view?.notice)?.view?.notice;
  const error = calls.find(({ call }) => call.error_text)?.call.error_text;
  const issue = calls.find(({ state }) => !['complete', 'running'].includes(state))?.state;
  const calculation = first?.calculation;
  return (
    notice ||
    (calculation
      ? `${calculation.expression} ${calculation.exact === false ? '≈' : '='} ${calculation.result}`
      : first?.summary || error || (issue ? state_label(issue) : undefined))
  );
}

function group_state(states: string[]) {
  if (states.includes('running')) return 'running';
  if (states.includes('waiting')) return 'waiting';
  if (states.includes('complete')) return 'complete';
  return states[0] ?? 'unreadable';
}

function status_title(state: string, title: string) {
  if (state === 'running') return `${title} in progress`;
  if (state === 'waiting') return `${title} waiting`;
  if (state === 'failed') return `${title} failed`;
  if (state === 'denied') return `${title} not allowed`;
  if (state === 'stopped') return `${title} stopped`;
  return title;
}

function state_label(state: string) {
  if (state === 'waiting') return 'Waiting for approval';
  if (state === 'unreadable') return 'Result unavailable';
  return state[0]?.toUpperCase() + state.slice(1);
}
