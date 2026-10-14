import { cn } from '@coworker/ui/lib/utils';
import { Brain } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  ActivityChevron,
  ActivityDetail,
  ActivityGlyph,
  activity_row_class_name,
  activity_row_hover_scope_class_name,
} from '@/components/app/chat_activity_row';
import {
  chat_lookback_labels,
  type LookupToolRowLabel,
  type LookupToolTense,
  read_lookup_tool_tense,
} from '@/components/app/lookup_tool_words';

export function LookupToolRow({
  children,
  errorText,
  label,
  tense,
}: {
  children?: ReactNode;
  errorText?: string | undefined;
  label: LookupToolRowLabel;
  tense: LookupToolTense;
}) {
  const [is_open, set_is_open] = useState(false);
  const expandable = Boolean(children);

  return (
    <div className="min-w-0">
      <button
        aria-expanded={expandable ? is_open : undefined}
        className={cn(
          activity_row_hover_scope_class_name,
          activity_row_class_name,
          'w-fit max-w-full text-left transition-colors',
          expandable ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
        )}
        disabled={!expandable}
        type="button"
        onClick={() => set_is_open(!is_open)}
      >
        <ActivityChevron expandable={expandable} open={is_open} />
        <ActivityGlyph
          breathing={tense === 'running'}
          icon={Brain}
          tone={tense === 'failed' ? 'failed' : 'default'}
        />
        <span className="min-w-0">
          {label.lead}
          {label.detail ? <ActivityDetail>{label.detail}</ActivityDetail> : null}
          {tense === 'failed' && errorText ? (
            <ActivityDetail tone="failed">{errorText}</ActivityDetail>
          ) : null}
        </span>
      </button>
      {expandable && is_open ? (
        <div className="mt-2 mb-1 ml-[25px] flex min-w-0 flex-wrap gap-1.5">{children}</div>
      ) : null}
    </div>
  );
}

export function ChatLookbackRow({
  errorText,
  isRunActive,
  state,
}: {
  errorText?: string | undefined;
  isRunActive: boolean;
  state: string;
}) {
  const tense = read_lookup_tool_tense({
    state,
    error_text: errorText,
    is_run_active: isRunActive,
  });
  return (
    <LookupToolRow
      errorText={errorText}
      label={{ lead: chat_lookback_labels[tense] }}
      tense={tense}
    />
  );
}
