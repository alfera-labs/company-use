import { cn } from '@coworker/ui/lib/utils';
import { useState } from 'react';
import { activity_detail_class_name } from '@/components/app/chat_activity_row';
import { read_tool_result_items } from '@/components/app/tool_result_items';
import { ToolResultList } from '@/components/app/tool_result_list';
import {
  read_tool_detail_input,
  read_tool_detail_output,
} from '@/components/prompt-kit/tool_detail_payload';
import {
  is_plain_object,
  stringify_value,
  ToolDetailTree,
} from '@/components/prompt-kit/tool_detail_tree';
import { copy_text } from '@/lib/copy_text';

export function ToolDetailBody({
  errorText,
  iconUrl,
  input,
  output,
  toolName,
}: {
  errorText?: string;
  iconUrl?: string | undefined;
  input?: unknown;
  output?: unknown;
  toolName: string;
}) {
  const displayed_input = read_tool_detail_input(input);
  const displayed_output = dedupe_output_value(read_tool_detail_output(output));
  const has_input = has_detail_value(displayed_input);
  const has_output = has_detail_value(displayed_output);
  const result_items = read_tool_result_items(displayed_output);

  return (
    <>
      {has_input ? (
        <ToolDetailSection label="Input" rawText={detail_raw_text(displayed_input)}>
          <ToolDetailTree value={displayed_input} />
        </ToolDetailSection>
      ) : null}
      {errorText ? (
        <ToolDetailSection label="Error" tone="failed">
          <div className="whitespace-pre-wrap break-words">{errorText}</div>
        </ToolDetailSection>
      ) : has_output ? (
        <ToolDetailSection label="Output" rawText={detail_raw_text(displayed_output)}>
          {result_items.length > 0 ? (
            <ToolResultList
              items={result_items}
              toolName={toolName}
              {...(iconUrl ? { iconUrl } : {})}
            />
          ) : (
            <ToolDetailTree value={displayed_output} />
          )}
        </ToolDetailSection>
      ) : null}
    </>
  );
}

function ToolDetailSection({
  children,
  label,
  rawText,
  tone,
}: {
  children: React.ReactNode;
  label: string;
  rawText?: string;
  tone?: 'failed';
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={cn('text-[11px] tracking-[0.07em] uppercase', activity_detail_class_name)}>
          {label}
        </span>
        {rawText !== undefined ? <CopyButton text={rawText} /> : null}
      </div>
      <div
        className={cn(
          'max-h-60 min-w-0 overflow-auto',
          tone === 'failed' ? 'text-destructive' : '',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, set_copied] = useState(false);

  async function copy_section_text() {
    try {
      await copy_text(text);
      set_copied(true);
      window.setTimeout(() => set_copied(false), 1400);
    } catch (error) {
      console.debug('copy tool detail section: clipboard denied', error);
    }
  }

  return (
    <button
      className="ml-auto shrink-0 rounded text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/tool-detail:opacity-100 hover:text-foreground focus-visible:opacity-100"
      type="button"
      onClick={copy_section_text}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function dedupe_output_value(value: unknown): unknown {
  if (!is_plain_object(value)) return value;
  const { content_json, content_text, ...rest } = value;
  if (content_json === undefined || typeof content_text !== 'string') return value;
  if (!texts_are_equivalent(stringify_value(content_json), content_text)) return value;
  return { ...rest, content_json };
}

function texts_are_equivalent(left: string, right: string) {
  return normalize_for_compare(left) === normalize_for_compare(right);
}

function normalize_for_compare(text: string) {
  return text.replace(/\s+/gu, '');
}

function detail_raw_text(value: unknown) {
  return typeof value === 'string' ? value : stringify_value(value);
}

export function has_detail_value(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}
