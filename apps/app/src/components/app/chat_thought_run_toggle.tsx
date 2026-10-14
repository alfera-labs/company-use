import { cn } from '@coworker/ui/lib/utils';
import { Cloud } from 'lucide-react';
import {
  ActivityChevron,
  ActivityDetail,
  ActivityGlyph,
  activity_row_class_name,
  activity_row_hover_scope_class_name,
} from '@/components/app/chat_activity_row';
import type { ProjectedChatMessagePart } from '@/components/app/chat_stream_projection';

export type ReasoningPart = Extract<ProjectedChatMessagePart, { type: 'reasoning' }>;

const collapse_whitespace_re = /\s+/gu;

export function ThoughtRunToggle({
  isOpen,
  isStreaming,
  parts,
  onToggle,
}: {
  isOpen: boolean;
  isStreaming: boolean;
  parts: ReasoningPart[];
  onToggle: () => void;
}) {
  const preview = thought_run_preview(parts);
  return (
    <button
      aria-expanded={isOpen}
      className={cn(
        activity_row_hover_scope_class_name,
        activity_row_class_name,
        'w-fit max-w-full cursor-pointer text-left transition-colors hover:text-foreground',
      )}
      type="button"
      onClick={onToggle}
    >
      <ActivityChevron expandable open={isOpen} />
      <ActivityGlyph
        breathing={isStreaming}
        icon={Cloud}
        tone={isStreaming ? 'running' : 'default'}
      />
      <span className="min-w-0">
        <span className="shrink-0">{thought_run_label(parts)}</span>
        {preview && !isOpen ? (
          <ActivityDetail>
            <span className="inline-block max-w-[min(24rem,48vw)] truncate align-bottom">
              {preview}
            </span>
          </ActivityDetail>
        ) : null}
      </span>
    </button>
  );
}

function thought_run_label(parts: ReasoningPart[]) {
  if (parts.some((part) => part.state === 'streaming')) return 'Thinking…';
  const duration_ms = parts.reduce((total, part) => total + (part.durationMs ?? 0), 0);
  return duration_ms > 0 ? `Thought for ${format_reasoning_duration(duration_ms)}` : 'Thought';
}

function thought_run_preview(parts: ReasoningPart[]) {
  const text = parts
    .map((part) => part.text.replace(collapse_whitespace_re, ' ').trim())
    .filter(Boolean)
    .at(-1);
  if (!text) return '';
  if (text.length <= 64) return text;

  const clipped_text = text.slice(0, 65);
  const last_word_end = clipped_text.lastIndexOf(' ');
  const preview_end = last_word_end >= 40 ? last_word_end : 64;
  return `${clipped_text.slice(0, preview_end).trimEnd()}…`;
}

function format_reasoning_duration(duration_ms: number) {
  const seconds = Math.max(1, Math.round(duration_ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining_seconds = seconds % 60;
  return remaining_seconds === 0 ? `${minutes}m` : `${minutes}m ${remaining_seconds}s`;
}
