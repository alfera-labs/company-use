import type { Database } from '@coworker/core';
import { list_run_assistant_message_contents } from '@coworker/core/db/queries/stored_tool_result_reads';
import {
  cap_strings_in_tool_payload,
  create_logger,
  type MessageContent,
  order_keys_like_jsonb,
  type StoredToolItemOutput,
  type ToolCallItem,
} from '@coworker/shared';
import {
  model_tool_result_text,
  rebuild_model_tool_result,
} from '@runtime-platform/chat_stream/stored_chat_tool_items';
import type { LargeValueReading } from '@runtime-platform/tools/stored_tool_result';
import {
  type LoadedToolCall,
  load_tool_calls,
  type ReadInput,
} from '@runtime-platform/tools/stored_tool_result_reads';
import { model_result_from_tool_result_v2 } from '@runtime-platform/tools/stored_tool_result_shape';

const log = create_logger('stored_chat_event_reads');

type ChatEventRow = { event_type: string; event_data: unknown };
type StoredToolItem = ToolCallItem & { stored_output: StoredToolItemOutput };

export async function restore_chat_event_tool_outputs<T extends ChatEventRow>(
  db: Database,
  input: ReadInput<T>,
): Promise<T[]> {
  const items = input.rows.flatMap((row) => {
    const item = read_stored_tool_item(row);
    return item ? [item] : [];
  });
  if (items.length === 0) return input.rows;

  const sources = await load_item_sources(db, { ...input, items });
  return input.rows.map((row) => {
    const item = read_stored_tool_item(row);
    if (!item) return row;
    const event_data = row.event_data as { item: ToolCallItem };
    return { ...row, event_data: { ...event_data, item: restore_tool_item(item, sources) } };
  });
}

function read_stored_tool_item(row: ChatEventRow): StoredToolItem | undefined {
  if (row.event_type !== 'chat_event') return undefined;
  const item = (row.event_data as { item?: Partial<ToolCallItem> } | null)?.item;
  if (!item || item.item_type !== 'tool_call' || !item.stored_output) return undefined;
  return item as StoredToolItem;
}

function reads_model_call(item: StoredToolItem) {
  return (
    item.stored_output.output_data_from === 'model_tool_result' ||
    item.stored_output.input_data_from === 'assistant_tool_call'
  );
}

function model_call_key(item: StoredToolItem) {
  return `${item.run_id}:${item.provider_tool_call_id ?? item.tool_call_id}`;
}

type ItemSources = {
  call_by_id: Map<string, LoadedToolCall>;
  call_by_key: Map<string, LoadedToolCall>;
  arguments_by_call: Map<string, unknown>;
};

async function load_item_sources(
  db: Database,
  input: { workspace_id: string; reading: LargeValueReading; items: StoredToolItem[] },
): Promise<ItemSources> {
  const model_items = input.items.filter(reads_model_call);
  const [calls, arguments_by_call] = await Promise.all([
    load_tool_calls(db, {
      workspace_id: input.workspace_id,
      tool_call_ids: input.items
        .filter((item) => !reads_model_call(item))
        .map((i) => i.tool_call_id),
      idempotency_keys: model_items.map(model_call_key),
      reading: input.reading,
    }),
    load_model_call_arguments(db, input.workspace_id, model_items),
  ]);
  return {
    call_by_id: new Map(calls.map((call) => [call.tool_call_id, call])),
    call_by_key: new Map(
      calls.flatMap((call) => (call.idempotency_key ? [[call.idempotency_key, call]] : [])),
    ),
    arguments_by_call,
  };
}

async function load_model_call_arguments(
  db: Database,
  workspace_id: string,
  items: StoredToolItem[],
) {
  const needs_arguments = items.filter(
    (item) => item.stored_output.input_data_from === 'assistant_tool_call',
  );
  const messages = await list_run_assistant_message_contents(db, {
    workspace_id,
    run_ids: needs_arguments.map((item) => item.run_id),
  });
  const arguments_by_call = new Map<string, unknown>();
  for (const message of messages) {
    for (const part of (message.message_content as MessageContent).parts ?? []) {
      if (part.type === 'tool_call')
        arguments_by_call.set(`${message.run_id}:${part.id}`, part.arguments);
    }
  }
  return arguments_by_call;
}

function restore_tool_item(item: StoredToolItem, sources: ItemSources): ToolCallItem {
  const { stored_output, ...kept } = item;
  const call = reads_model_call(item)
    ? sources.call_by_key.get(model_call_key(item))
    : sources.call_by_id.get(item.tool_call_id);
  const model_result = rebuild_model_result(stored_output, call);
  const input = restored_input(
    stored_output,
    call,
    sources.arguments_by_call.get(model_call_key(item)),
  );
  const output = restored_output(stored_output, call, model_result);
  const input_missing = stored_output.input_data_from !== undefined && !('input_data' in input);
  const output_missing = stored_output.output_data_from !== undefined && !('output_data' in output);
  if (input_missing || output_missing) {
    log.warn('A stored chat tool item could not be restored in full.', {
      tool_call_id: item.tool_call_id,
      run_id: item.run_id,
      input_missing,
      output_missing,
    });
  }
  return order_keys_like_jsonb(cap_strings_in_tool_payload({ ...kept, ...input, ...output }));
}

function rebuild_model_result(sources: StoredToolItemOutput, call: LoadedToolCall | undefined) {
  if (sources.output_data_from !== 'model_tool_result' || !call?.stored_result) return undefined;
  return order_keys_like_jsonb(
    rebuild_model_tool_result(model_result_from_tool_result_v2(call.stored_result), sources),
  );
}

function restored_input(
  sources: StoredToolItemOutput,
  call: LoadedToolCall | undefined,
  model_arguments: unknown,
) {
  if (sources.input_data_from === 'tool_call_row' && call) return { input_data: call.input_data };
  if (sources.input_data_from === 'assistant_tool_call' && model_arguments !== undefined) {
    return { input_data: model_arguments };
  }
  return {};
}

function restored_output(
  sources: StoredToolItemOutput,
  call: LoadedToolCall | undefined,
  model_result: unknown,
) {
  const output_data =
    sources.output_data_from === 'null'
      ? { output_data: null }
      : sources.output_data_from === 'tool_call_row' && call
        ? { output_data: call.output_data }
        : model_result === undefined
          ? {}
          : { output_data: model_result };
  const output_text =
    sources.output_text_from === 'tool_call_row' && call?.output_text != null
      ? { output_text: call.output_text }
      : sources.output_text_from === 'model_tool_result' && model_result !== undefined
        ? { output_text: model_tool_result_text(model_result) }
        : {};
  return { ...output_data, ...output_text };
}
