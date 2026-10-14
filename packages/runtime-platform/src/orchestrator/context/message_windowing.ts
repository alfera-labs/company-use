import {
  context_message_roles,
  type MessageForContext,
} from '@runtime-platform/orchestrator/context/context_types';
import { estimate_message_tokens } from '@runtime-platform/orchestrator/context/token_estimation';
import {
  type ContextMessageUnit,
  group_tool_protocol_messages,
  messages_from_units,
  unit_containing_message,
} from '@runtime-platform/orchestrator/context/tool_protocol_windowing';

// Selects recent model-visible conversation. Assistant tool calls and their matching tool results
// form one selection unit, so windowing never preserves only half of a provider protocol exchange.

export function select_context_messages<T extends MessageForContext>(
  messages: T[],
  input: {
    summarized_until_message_id?: string | null;
    recent_message_limit: number;
    recent_token_budget?: number;
  },
): T[] {
  const conversation = messages_after_summary_boundary(
    messages,
    input.summarized_until_message_id,
  ).filter(is_context_message);

  const limit = Math.max(input.recent_message_limit, 1);
  const units = group_tool_protocol_messages(conversation);
  const recent_units = take_newest_units_that_fit(
    units,
    limit,
    input.recent_token_budget ?? Number.POSITIVE_INFINITY,
  );
  const recent_messages = messages_from_units(conversation, recent_units);

  const first_user_message = conversation.find((message) => message.message_role === 'user');
  if (
    first_user_message === undefined ||
    recent_messages.some((message) => message.run_message_id === first_user_message.run_message_id)
  ) {
    return recent_messages;
  }

  const units_with_anchor = make_room_for_user_anchor(
    recent_units,
    unit_containing_message(units, first_user_message.run_message_id),
    limit,
  );
  return messages_from_units(conversation, units_with_anchor);
}

function messages_after_summary_boundary<T extends { run_message_id: string }>(
  messages: T[],
  summarized_until_message_id: string | null | undefined,
): T[] {
  if (summarized_until_message_id === undefined || summarized_until_message_id === null) {
    return messages;
  }

  const boundary_index = messages.findIndex(
    (message) => message.run_message_id === summarized_until_message_id,
  );
  return boundary_index === -1 ? messages : messages.slice(boundary_index + 1);
}

function is_context_message(message: MessageForContext) {
  return (
    message.is_model_visible !== false &&
    !is_reasoning_summary(message.message_content) &&
    context_message_roles.has(message.message_role)
  );
}

function is_reasoning_summary(message_content: unknown) {
  return (
    typeof message_content === 'object' &&
    message_content !== null &&
    !Array.isArray(message_content) &&
    (message_content as Record<string, unknown>).type === 'reasoning_summary'
  );
}

function take_newest_units_that_fit<T extends MessageForContext>(
  units: ContextMessageUnit<T>[],
  limit: number,
  token_budget: number,
) {
  const selected: ContextMessageUnit<T>[] = [];
  let message_total = 0;
  let token_total = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) continue;
    const unit_tokens = unit.messages.reduce(
      (total, message) => total + estimate_message_tokens(message),
      0,
    );
    const exceeds_limit = message_total + unit.messages.length > limit;
    const exceeds_budget = token_total + unit_tokens > token_budget;
    if (selected.length > 0 && (exceeds_limit || exceeds_budget)) break;
    selected.push(unit);
    message_total += unit.messages.length;
    token_total += unit_tokens;
  }

  return selected.reverse();
}

function make_room_for_user_anchor<T>(
  recent_units: ContextMessageUnit<T>[],
  anchor_unit: ContextMessageUnit<T> | undefined,
  limit: number,
) {
  if (!anchor_unit) return recent_units;
  const selected = [...recent_units];
  while (
    selected.length > 0 &&
    count_unit_messages(selected) + anchor_unit.messages.length > limit
  ) {
    selected.shift();
  }
  return [anchor_unit, ...selected];
}

function count_unit_messages<T>(units: ContextMessageUnit<T>[]) {
  return units.reduce((total, unit) => total + unit.messages.length, 0);
}
