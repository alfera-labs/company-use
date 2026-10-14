import {
  context_message_roles,
  type MessageForContext,
} from '@runtime-platform/orchestrator/context/context_types';
import {
  format_current_turn_context,
  type SessionCurrentTurnContext,
} from '@runtime-platform/orchestrator/context/current_turn_context';
import {
  estimate_context_tokens_roughly,
  estimate_message_tokens,
} from '@runtime-platform/orchestrator/context/token_estimation';

export type SessionContextPacketName =
  | 'system'
  | 'current_turn'
  | 'persisted_summary'
  | 'first_user_message'
  | 'recent_messages'
  | 'tool_results'
  | 'environment'
  | 'capability_manifest';

export type SessionContextPacket = {
  packet_name: SessionContextPacketName;
  included_because: string;
  content_pointer: unknown;
  content_inline: unknown;
  token_count: number;
  omitted_items: { reason: string; count: number }[];
};

export function build_context_packets(input: {
  workspace_id: string;
  session_id: string;
  system_instructions: string;
  current_turn_context?: SessionCurrentTurnContext;
  context_summary: string | null;
  summarized_until_message_id: string | null;
  source_messages: MessageForContext[];
  selected_messages: MessageForContext[];
}): SessionContextPacket[] {
  const packets: SessionContextPacket[] = [create_system_packet(input.system_instructions)];
  const current_turn_packet = create_current_turn_packet(input.current_turn_context);
  if (current_turn_packet) packets.push(current_turn_packet);
  if (input.context_summary) packets.push(create_persisted_summary_packet(input));

  const first_user_message = input.selected_messages.find(
    (message) => message.message_role === 'user',
  );
  const recent_messages = input.selected_messages.filter(
    (message) =>
      message.run_message_id !== first_user_message?.run_message_id &&
      message.message_role !== 'tool_result',
  );
  const tool_result_messages = input.selected_messages.filter(
    (message) => message.message_role === 'tool_result',
  );

  if (first_user_message) packets.push(create_first_user_message_packet(first_user_message));
  const recent_messages_packet = create_recent_messages_packet(
    input.source_messages,
    input.selected_messages,
    recent_messages,
  );
  if (recent_messages.length > 0 || recent_messages_packet.omitted_items.length > 0) {
    packets.push(recent_messages_packet);
  }
  if (tool_result_messages.length > 0) {
    packets.push(create_tool_results_packet(tool_result_messages));
  }

  return packets;
}

function create_system_packet(system_instructions: string): SessionContextPacket {
  return {
    packet_name: 'system',
    included_because: 'agent_system_instructions',
    content_pointer: null,
    content_inline: system_instructions,
    token_count: estimate_context_tokens_roughly(system_instructions),
    omitted_items: [],
  };
}

function create_current_turn_packet(
  current_turn_context?: SessionCurrentTurnContext,
): SessionContextPacket | null {
  const content = format_current_turn_context(current_turn_context);
  if (!content) return null;

  return {
    packet_name: 'current_turn',
    included_because: 'current_user_message_source',
    content_pointer: null,
    content_inline: content,
    token_count: estimate_context_tokens_roughly(content),
    omitted_items: [],
  };
}

function create_persisted_summary_packet(input: {
  workspace_id: string;
  session_id: string;
  context_summary: string | null;
  summarized_until_message_id: string | null;
}): SessionContextPacket {
  return {
    packet_name: 'persisted_summary',
    included_because: 'sessions.context_summary',
    content_pointer: {
      table: 'sessions',
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      columns: ['context_summary', 'summarized_until_message_id'],
    },
    content_inline: input.context_summary,
    token_count: estimate_context_tokens_roughly(input.context_summary),
    omitted_items: input.summarized_until_message_id
      ? []
      : [{ reason: 'summary_boundary_missing', count: 1 }],
  };
}

function create_first_user_message_packet(message: MessageForContext): SessionContextPacket {
  return {
    packet_name: 'first_user_message',
    included_because: 'first_unsummarized_user_anchor',
    content_pointer: run_message_pointer([message.run_message_id]),
    content_inline: null,
    token_count: estimate_message_tokens(message),
    omitted_items: [],
  };
}

function create_recent_messages_packet(
  source_messages: MessageForContext[],
  selected_messages: MessageForContext[],
  recent_messages: MessageForContext[],
): SessionContextPacket {
  return {
    packet_name: 'recent_messages',
    included_because: 'recent_window',
    content_pointer: run_message_pointer(recent_messages.map((message) => message.run_message_id)),
    content_inline: null,
    token_count: estimate_context_tokens_roughly(
      recent_messages.map((message) => message.message_content),
    ),
    omitted_items: omitted_context_message_items(source_messages, selected_messages),
  };
}

function create_tool_results_packet(messages: MessageForContext[]): SessionContextPacket {
  return {
    packet_name: 'tool_results',
    included_because: 'selected_tool_results_visible_to_model',
    content_pointer: run_message_pointer(messages.map((message) => message.run_message_id)),
    content_inline: null,
    token_count: estimate_context_tokens_roughly(
      messages.map((message) => message.message_content),
    ),
    omitted_items: [],
  };
}

export function create_capability_manifest_packet(tools: unknown[]): SessionContextPacket {
  return {
    packet_name: 'capability_manifest',
    included_because: 'runtime_tools_available_for_run',
    content_pointer: null,
    content_inline: tools,
    token_count: estimate_context_tokens_roughly(tools),
    omitted_items: [],
  };
}

export function create_environment_packet(
  environment_context: Record<string, unknown>,
): SessionContextPacket {
  return {
    packet_name: 'environment',
    included_because: 'workspace_runtime_available_for_run',
    content_pointer: null,
    content_inline: environment_context,
    token_count: estimate_context_tokens_roughly(environment_context),
    omitted_items: [],
  };
}

function run_message_pointer(run_message_ids: string[]) {
  return {
    table: 'run_messages',
    id_column: 'run_message_id',
    ids: run_message_ids,
  };
}

function omitted_context_message_items(
  source_messages: MessageForContext[],
  selected_messages: MessageForContext[],
) {
  const selected_message_ids = new Set(selected_messages.map((message) => message.run_message_id));
  const omitted_message_count = source_messages.filter(
    (message) =>
      context_message_roles.has(message.message_role) &&
      !selected_message_ids.has(message.run_message_id),
  ).length;

  return omitted_message_count === 0
    ? []
    : [{ reason: 'recent_window_budget', count: omitted_message_count }];
}
