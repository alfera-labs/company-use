import type { Database } from '@coworker/core';
import { find_tool_call_output_shape } from '@coworker/core/db/queries/stored_tool_result_reads';
import { create_logger, order_keys_like_jsonb } from '@coworker/shared';
import {
  read_rebuildable_model_result,
  rebuild_model_tool_result,
} from '@runtime-platform/chat_stream/stored_chat_tool_items';
import { load_tool_calls } from '@runtime-platform/tools/stored_tool_result_reads';
import {
  model_result_from_tool_result_v2,
  tool_result_v2_shape,
} from '@runtime-platform/tools/stored_tool_result_shape';

export const runtime_tool_event_v2_shape = 'runtime_tool_event_v2';
const tool_end_event_label = 'pi.tool_execution_end';
const result_preview_chars = 1_024;
const log = create_logger('stored_runtime_tool_events');

type RuntimeToolEventV2 = Record<string, unknown> & {
  shape: typeof runtime_tool_event_v2_shape;
  tool_call_id: string;
  result_preview: string;
  result_metadata: Record<string, unknown>;
  result_terminates_run?: true;
};

export async function metadata_to_store_for_runtime_event(
  db: Database,
  input: {
    workspace_id: string;
    run_id: string;
    event_label: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const { metadata } = input;
  if (input.event_label !== tool_end_event_label || metadata.is_error !== false) return metadata;
  if (typeof metadata.tool_call_id !== 'string') return metadata;
  const rebuild = read_rebuildable_model_result(metadata.result);
  if (!rebuild) return metadata;
  const output_shape = await find_tool_call_output_shape(db, {
    workspace_id: input.workspace_id,
    idempotency_key: `${input.run_id}:${metadata.tool_call_id}`,
  });
  if (output_shape !== tool_result_v2_shape) return metadata;

  const { result, ...kept } = metadata;
  return {
    ...kept,
    tool_call_id: metadata.tool_call_id,
    shape: runtime_tool_event_v2_shape,
    result_preview: result_text_preview(result),
    result_metadata: rebuild.metadata,
    ...(rebuild.terminates_run ? { result_terminates_run: true } : {}),
  } satisfies RuntimeToolEventV2;
}

function result_text_preview(result: unknown) {
  const content = (result as { content?: Array<{ type?: string; text?: unknown }> }).content ?? [];
  return content
    .flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
    .slice(0, result_preview_chars);
}

type RunEventRow = { run_id: string; event_metadata?: unknown };

export async function restore_runtime_tool_events<T extends RunEventRow>(
  db: Database,
  input: { workspace_id: string; rows: T[] },
): Promise<T[]> {
  const stored = input.rows.flatMap((row) => {
    const metadata = read_runtime_tool_event_v2(row.event_metadata);
    return metadata ? [{ row, key: `${row.run_id}:${metadata.tool_call_id}` }] : [];
  });
  if (stored.length === 0) return input.rows;

  const calls = await load_tool_calls(db, {
    workspace_id: input.workspace_id,
    idempotency_keys: stored.map(({ key }) => key),
    reading: 'load_full_value',
  });
  const call_by_key = new Map(calls.map((call) => [call.idempotency_key, call]));
  return input.rows.map((row) => {
    const metadata = read_runtime_tool_event_v2(row.event_metadata);
    if (!metadata) return row;
    const call = call_by_key.get(`${row.run_id}:${metadata.tool_call_id}`);
    if (!call?.stored_result) {
      log.warn('A stored engine tool event points at a call with no stored result.', {
        run_id: row.run_id,
        model_tool_call_id: metadata.tool_call_id,
      });
      return row;
    }
    const { shape: _shape, result_preview: _preview, result_metadata, ...fields } = metadata;
    const { result_terminates_run, ...kept } = fields;
    const result = rebuild_model_tool_result(model_result_from_tool_result_v2(call.stored_result), {
      model_result_metadata: result_metadata,
      ...(result_terminates_run ? { model_result_terminates_run: true } : {}),
    });
    return { ...row, event_metadata: order_keys_like_jsonb({ ...kept, result }) };
  });
}

function read_runtime_tool_event_v2(value: unknown): RuntimeToolEventV2 | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const metadata = value as Partial<RuntimeToolEventV2>;
  return metadata.shape === runtime_tool_event_v2_shape && typeof metadata.tool_call_id === 'string'
    ? (metadata as RuntimeToolEventV2)
    : undefined;
}
