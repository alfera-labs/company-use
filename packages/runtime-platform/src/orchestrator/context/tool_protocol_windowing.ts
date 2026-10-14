import type { MessageForContext } from '@runtime-platform/orchestrator/context/context_types';

export type ContextMessageUnit<T> = { messages: T[] };

type ToolProtocolUnit<T> = ContextMessageUnit<T> & {
  pending_tool_call_ids?: Set<string>;
};

export function group_tool_protocol_messages<T extends MessageForContext>(messages: T[]) {
  const units: ToolProtocolUnit<T>[] = [];
  const unit_by_tool_call_id = new Map<string, ToolProtocolUnit<T>>();

  for (const message of messages) {
    if (message.message_role === 'tool_result') {
      add_tool_result_to_unit(message, unit_by_tool_call_id);
      continue;
    }

    const tool_call_ids = list_tool_call_ids(message.message_content);
    const unit: ToolProtocolUnit<T> = {
      messages: [message],
      ...(tool_call_ids.length > 0 ? { pending_tool_call_ids: new Set(tool_call_ids) } : {}),
    };
    units.push(unit);
    for (const tool_call_id of tool_call_ids) {
      unit_by_tool_call_id.set(tool_call_id, unit);
    }
  }

  return units.filter((unit) => !unit.pending_tool_call_ids?.size);
}

export function messages_from_units<T extends MessageForContext>(
  messages: T[],
  units: ContextMessageUnit<T>[],
) {
  const selected_ids = new Set(
    units.flatMap((unit) => unit.messages.map((message) => message.run_message_id)),
  );
  return messages.filter((message) => selected_ids.has(message.run_message_id));
}

export function unit_containing_message<T extends MessageForContext>(
  units: ContextMessageUnit<T>[],
  run_message_id: string,
) {
  return units.find((unit) =>
    unit.messages.some((message) => message.run_message_id === run_message_id),
  );
}

function add_tool_result_to_unit<T extends MessageForContext>(
  message: T,
  unit_by_tool_call_id: Map<string, ToolProtocolUnit<T>>,
) {
  const tool_call_id = find_tool_result_id(message);
  const unit = unit_by_tool_call_id.get(tool_call_id ?? '');
  if (!unit) return;
  unit.messages.push(message);
  if (tool_call_id) {
    unit.pending_tool_call_ids?.delete(tool_call_id);
    unit_by_tool_call_id.delete(tool_call_id);
  }
}

function list_tool_call_ids(message_content: MessageForContext['message_content']) {
  return (message_content?.parts ?? [])
    .filter((part) => part.type === 'tool_call')
    .map((part) => part.id);
}

function find_tool_result_id(message: MessageForContext) {
  const result = (message.message_content?.parts ?? []).find((part) => part.type === 'tool_result');
  if (result?.type === 'tool_result' && result.tool_call_id) return result.tool_call_id;
  const data = message.message_content?.data;
  if (typeof data?.model_tool_call_id === 'string') return data.model_tool_call_id;
  if (message.tool_call_id) return message.tool_call_id;
  return typeof data?.tool_call_id === 'string' ? data.tool_call_id : undefined;
}
