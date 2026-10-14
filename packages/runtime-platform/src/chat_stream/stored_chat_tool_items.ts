import { isDeepStrictEqual } from 'node:util';
import { runtime_tool_result_to_agent_tool_result } from '@agent-core/engines/pi/pi_tools';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { ChatStreamEventDraft, StoredToolItemOutput, ToolCallItem } from '@coworker/shared';

export const stored_tool_item_output_text_chars = 1_024;

type ToolItemDraft = Extract<
  ChatStreamEventDraft,
  { event_type: 'item_started' | 'item_completed' }
>;

export function slim_chat_event_draft_for_storage(
  draft: ChatStreamEventDraft,
): ChatStreamEventDraft {
  if (draft.event_type !== 'item_started' && draft.event_type !== 'item_completed') return draft;
  if (draft.item.item_type !== 'tool_call') return draft;

  const stored_output =
    draft.source.source_type === 'tool_lifecycle'
      ? tool_call_row_sources(draft.item)
      : model_event_sources(draft as ToolItemDraft & { item: ToolCallItem });
  if (!stored_output) return draft;
  return { ...draft, item: slim_tool_item(draft.item, stored_output) };
}

function tool_call_row_sources(item: ToolCallItem): StoredToolItemOutput | undefined {
  const sources: StoredToolItemOutput = {
    shape: 'chat_tool_item_v2',
    ...(item.input_data === undefined ? {} : { input_data_from: 'tool_call_row' as const }),
    ...(item.output_data === undefined
      ? {}
      : { output_data_from: item.output_data === null ? ('null' as const) : 'tool_call_row' }),
    ...(is_longer_than_preview(item.output_text)
      ? { output_text_from: 'tool_call_row' as const }
      : {}),
  };
  return has_sources(sources) ? sources : undefined;
}

function model_event_sources(
  draft: ToolItemDraft & { item: ToolCallItem },
): StoredToolItemOutput | undefined {
  const { item } = draft;
  const input_source =
    item.input_data === undefined ? {} : { input_data_from: 'assistant_tool_call' as const };
  const rebuild =
    draft.event_type === 'item_completed' && !item.error
      ? read_rebuildable_model_result(item.output_data)
      : undefined;
  const sources: StoredToolItemOutput = {
    shape: 'chat_tool_item_v2',
    ...input_source,
    ...(rebuild
      ? {
          output_data_from: 'model_tool_result' as const,
          ...(is_longer_than_preview(item.output_text)
            ? { output_text_from: 'model_tool_result' as const }
            : {}),
          model_result_metadata: rebuild.metadata,
          ...(rebuild.terminates_run ? { model_result_terminates_run: true as const } : {}),
        }
      : {}),
  };
  return has_sources(sources) ? sources : undefined;
}

export function read_rebuildable_model_result(output_data: unknown) {
  if (output_data === undefined) return undefined;
  const output = output_data as { details?: unknown; terminate?: unknown };
  const details = output?.details as (RuntimeToolResult & { metadata?: unknown }) | undefined;
  if (
    !details ||
    typeof details !== 'object' ||
    !details.ok ||
    details.content_json === undefined
  ) {
    return undefined;
  }
  const { metadata, ...result } = details;
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const terminates_run = output.terminate === true;
  const rebuilt = rebuild_model_tool_result(result as RuntimeToolResult, {
    model_result_metadata: metadata as Record<string, unknown>,
    ...(terminates_run ? { model_result_terminates_run: true } : {}),
  });
  if (!isDeepStrictEqual(rebuilt, output_data)) return undefined;
  return { metadata: metadata as Record<string, unknown>, terminates_run };
}

export function rebuild_model_tool_result(
  result: RuntimeToolResult,
  sources: Pick<StoredToolItemOutput, 'model_result_metadata' | 'model_result_terminates_run'>,
) {
  const agent_result = runtime_tool_result_to_agent_tool_result(
    result,
    sources.model_result_metadata ?? {},
  );
  return sources.model_result_terminates_run ? { ...agent_result, terminate: true } : agent_result;
}

export function model_tool_result_text(value: unknown) {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function slim_tool_item(item: ToolCallItem, stored_output: StoredToolItemOutput): ToolCallItem {
  const { input_data: _input, output_data: _output, output_text, ...kept } = item;
  const keeps = (field: 'input_data' | 'output_data') =>
    stored_output[`${field}_from`] === undefined && item[field] !== undefined
      ? { [field]: item[field] }
      : {};
  return {
    ...kept,
    ...keeps('input_data'),
    ...keeps('output_data'),
    ...(output_text === undefined
      ? {}
      : {
          output_text: stored_output.output_text_from
            ? output_text.slice(0, stored_tool_item_output_text_chars)
            : output_text,
        }),
    stored_output,
  };
}

function is_longer_than_preview(output_text: string | undefined) {
  return output_text !== undefined && output_text.length > stored_tool_item_output_text_chars;
}

function has_sources(sources: StoredToolItemOutput) {
  return (
    sources.input_data_from !== undefined ||
    sources.output_data_from !== undefined ||
    sources.output_text_from !== undefined
  );
}
