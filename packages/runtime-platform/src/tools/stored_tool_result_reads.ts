import type { Database } from '@coworker/core';
import { list_tool_call_outputs } from '@coworker/core/db/queries/stored_tool_result_reads';
import { create_logger, type MessageContent, order_keys_like_jsonb } from '@coworker/shared';
import {
  type LargeValueReading,
  resolve_large_fields,
} from '@runtime-platform/tools/stored_tool_result';
import {
  is_tool_result_v2,
  message_result_from_tool_result_v2,
  type ToolResultV2,
  tool_call_output_from_tool_result_v2,
} from '@runtime-platform/tools/stored_tool_result_shape';
import {
  is_tool_result_message_pointer,
  tool_result_message_content,
} from '@runtime-platform/tools/tool_result_message_content';

const log = create_logger('stored_tool_result_reads');

export type ReadInput<T> = { workspace_id: string; rows: T[]; reading: LargeValueReading };

type ToolCallOutputRow = Awaited<ReturnType<typeof list_tool_call_outputs>>[number];

type ToolCallResultRow = Pick<
  ToolCallOutputRow,
  'tool_call_id' | 'tool_name' | 'tool_call_metadata' | 'output_data'
>;

type ResolvedToolCall = Pick<LoadedToolCall, 'tool_name' | 'tool_call_metadata' | 'stored_result'>;

export type LoadedToolCall = {
  tool_call_id: string;
  tool_name: string;
  tool_call_metadata: Record<string, unknown>;
  idempotency_key: string | null;
  input_data: unknown;
  output_text: string | null;
  output_data: unknown;
  stored_result?: ToolResultV2;
};

export async function restore_tool_call_outputs<T extends { output_data: unknown }>(
  db: Database,
  input: ReadInput<T>,
): Promise<T[]> {
  const stored = input.rows.flatMap((row) => (is_tool_result_v2(row.output_data) ? [row] : []));
  if (stored.length === 0) return input.rows;

  const resolved = await resolve_large_fields(db, {
    workspace_id: input.workspace_id,
    outputs: stored.map((row) => row.output_data as ToolResultV2),
    reading: input.reading,
  });
  const output_by_row = new Map(stored.map((row, index) => [row, resolved[index]]));
  return input.rows.map((row) => {
    const output = output_by_row.get(row);
    if (!output) return row;
    return {
      ...row,
      output_data: order_keys_like_jsonb(tool_call_output_from_tool_result_v2(output)),
    };
  });
}

export async function load_tool_calls(
  db: Database,
  input: {
    workspace_id: string;
    tool_call_ids?: string[];
    idempotency_keys?: string[];
    reading: LargeValueReading;
  },
): Promise<LoadedToolCall[]> {
  return resolve_tool_call_rows(db, { ...input, rows: await list_tool_call_outputs(db, input) });
}

async function resolve_tool_call_rows<T extends ToolCallResultRow>(
  db: Database,
  input: { workspace_id: string; rows: T[]; reading: LargeValueReading },
): Promise<Array<T & { stored_result?: ToolResultV2 }>> {
  const { rows } = input;
  const stored = rows.flatMap((row) => (is_tool_result_v2(row.output_data) ? [row] : []));
  const resolved = await resolve_large_fields(db, {
    workspace_id: input.workspace_id,
    outputs: stored.map((row) => row.output_data as ToolResultV2),
    reading: input.reading,
  });
  const result_by_id = new Map(stored.map((row, index) => [row.tool_call_id, resolved[index]]));
  return rows.map((row) => {
    const stored_result = result_by_id.get(row.tool_call_id);
    return {
      ...row,
      output_data: stored_result
        ? order_keys_like_jsonb(tool_call_output_from_tool_result_v2(stored_result))
        : row.output_data,
      ...(stored_result ? { stored_result } : {}),
    };
  });
}

type RunMessageRow = {
  message_content: unknown;
  tool_call_id?: string | null;
  source_metadata?: unknown;
  content_text?: string | null;
  content_json?: unknown;
};

export async function restore_run_message_tool_results<T extends RunMessageRow>(
  db: Database,
  input: ReadInput<T> & { tool_call_rows?: ToolCallResultRow[] },
): Promise<T[]> {
  const pointer_ids = input.rows.flatMap((row) =>
    is_tool_result_message_pointer(row.message_content)
      ? [row.message_content.parts[0].tool_call_id]
      : [],
  );
  if (pointer_ids.length === 0) return input.rows;

  const calls = input.tool_call_rows
    ? await resolve_tool_call_rows(db, { ...input, rows: input.tool_call_rows })
    : await load_tool_calls(db, { ...input, tool_call_ids: pointer_ids });
  const call_by_id = new Map<string, ResolvedToolCall>(
    calls.map((call) => [call.tool_call_id, call]),
  );
  return input.rows.map((row) => {
    if (!is_tool_result_message_pointer(row.message_content)) return row;
    const tool_call_id = row.message_content.parts[0].tool_call_id;
    return with_message_content(row, rebuild_message_content(row, tool_call_id, call_by_id));
  });
}

function rebuild_message_content(
  row: RunMessageRow,
  tool_call_id: string,
  call_by_id: Map<string, ResolvedToolCall>,
): MessageContent {
  const call = call_by_id.get(tool_call_id);
  if (!call?.stored_result) {
    log.error('A tool_result message points at a call with no stored result.', { tool_call_id });
  }
  const source_metadata = (row.source_metadata ?? {}) as Record<string, unknown>;
  const model_tool_call_id =
    source_metadata.model_tool_call_id ?? call?.tool_call_metadata.runtime_tool_call_id;
  return tool_result_message_content({
    tool_call_id,
    ...(typeof model_tool_call_id === 'string' ? { model_tool_call_id } : {}),
    tool_name: String(source_metadata.tool_name ?? call?.tool_name ?? ''),
    result: call?.stored_result
      ? message_result_from_tool_result_v2(call.stored_result)
      : { ok: true, content_text: row.content_text ?? '' },
  });
}

function with_message_content<T extends RunMessageRow>(row: T, content: MessageContent): T {
  return {
    ...row,
    message_content: order_keys_like_jsonb(content),
    ...('content_text' in row ? { content_text: content.text ?? null } : {}),
    ...('content_json' in row ? { content_json: order_keys_like_jsonb(content.data) ?? null } : {}),
  };
}
