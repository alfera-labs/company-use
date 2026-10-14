import {
  type PiSessionTreeEntry,
  runtime_messages_to_pi_agent_messages,
} from '@agent-core/engines/pi';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { MessageContent } from '@coworker/shared';
import { message_content_to_runtime_parts } from '@runtime-platform/orchestrator/runtime_message_content';

const model_visible_roles = new Set(['user', 'assistant', 'tool_result']);

export type HarnessRunMessage = {
  run_message_id: string;
  message_role: string;
  message_content: MessageContent;
  message_sequence: number;
  is_model_visible?: boolean;
  created_time?: Date | string | null;
  source_metadata?: unknown;
};

export type HarnessProjectionInput = {
  messages: HarnessRunMessage[];
  context_summary?: string | null;
  summarized_until_message_id?: string | null;
};

export type HarnessProjection = {
  entries: PiSessionTreeEntry[];
  projected_messages: HarnessRunMessage[];
  previous_compaction_entry?: PiSessionTreeEntry;
};

export function project_run_messages_to_pi_session_entries(
  input: HarnessProjectionInput,
): HarnessProjection {
  const visible_messages = visible_context_messages(input.messages);
  const boundary = messages_after_summary_boundary(visible_messages, input);
  const projected_messages = boundary.messages;
  const previous_compaction_entry = create_previous_compaction_entry(input, {
    projected_messages,
    boundary_found: boundary.found,
  });
  const entries = chain_entries([
    ...(previous_compaction_entry ? [previous_compaction_entry] : []),
    ...projected_messages.flatMap(run_message_to_pi_entry),
  ]);

  return {
    entries,
    projected_messages,
    ...(previous_compaction_entry === undefined ? {} : { previous_compaction_entry }),
  };
}

export function find_summarized_until_message_id(input: {
  entries: PiSessionTreeEntry[];
  first_kept_entry_id: string;
  previous_summarized_until_message_id?: string | null;
}) {
  const real_message_entries = input.entries.filter(is_real_message_entry);
  const kept_index = real_message_entries.findIndex(
    (entry) => entry.id === input.first_kept_entry_id,
  );

  if (kept_index <= 0) return input.previous_summarized_until_message_id ?? null;
  return real_message_entries[kept_index - 1]?.id ?? null;
}

export function count_model_visible_messages(messages: HarnessRunMessage[]) {
  return visible_context_messages(messages).length;
}

function visible_context_messages(messages: HarnessRunMessage[]) {
  return messages.filter(
    (message) =>
      message.is_model_visible !== false && model_visible_roles.has(message.message_role),
  );
}

function messages_after_summary_boundary(
  messages: HarnessRunMessage[],
  input: HarnessProjectionInput,
) {
  const boundary_id = input.summarized_until_message_id;
  if (!boundary_id) return { messages, found: false };

  const boundary_index = messages.findIndex((message) => message.run_message_id === boundary_id);
  return boundary_index === -1
    ? { messages, found: false }
    : { messages: messages.slice(boundary_index + 1), found: true };
}

function create_previous_compaction_entry(
  input: HarnessProjectionInput,
  boundary: { projected_messages: HarnessRunMessage[]; boundary_found: boolean },
): PiSessionTreeEntry | undefined {
  const summary = input.context_summary?.trim();
  const boundary_id = input.summarized_until_message_id;
  const first_kept_message = boundary.projected_messages[0];

  if (!summary || !boundary_id || !boundary.boundary_found || !first_kept_message) {
    return undefined;
  }

  return {
    type: 'compaction',
    id: `compaction:${boundary_id}`,
    parentId: null,
    timestamp: timestamp_for_entry(first_kept_message),
    summary,
    firstKeptEntryId: first_kept_message.run_message_id,
    tokensBefore: 0,
    details: { source: 'coworker.sessions.context_summary' },
    fromHook: true,
  };
}

function run_message_to_pi_entry(message: HarnessRunMessage): PiSessionTreeEntry[] {
  const runtime_message = run_message_to_runtime_message(message);
  const pi_messages = runtime_messages_to_pi_agent_messages([runtime_message]);

  return pi_messages.map((pi_message) => ({
    type: 'message',
    id: message.run_message_id,
    parentId: null,
    timestamp: timestamp_for_entry(message),
    message: pi_message,
  }));
}

function run_message_to_runtime_message(message: HarnessRunMessage): RuntimeAgentMessage {
  if (message.message_role === 'assistant') {
    return runtime_message_from_role('assistant', message);
  }

  if (message.message_role === 'tool_result') {
    return runtime_message_from_role('tool', message);
  }

  return runtime_message_from_role('user', message);
}

function runtime_message_from_role(
  role: RuntimeAgentMessage['role'],
  message: HarnessRunMessage,
): RuntimeAgentMessage {
  return {
    role,
    content: message_content_to_runtime_parts(message.message_content),
    metadata: runtime_metadata_for_message(message),
  };
}

function runtime_metadata_for_message(message: HarnessRunMessage) {
  const provider_metadata = provider_metadata_from_source(message.source_metadata);

  return {
    ...provider_metadata,
    timestamp: timestamp_millis(message.created_time),
  };
}

function provider_metadata_from_source(source_metadata: unknown) {
  if (!source_metadata || typeof source_metadata !== 'object') return {};

  const provider_metadata = (source_metadata as Record<string, unknown>).provider_metadata;
  if (!provider_metadata || typeof provider_metadata !== 'object') return {};

  return provider_metadata as Record<string, unknown>;
}

function chain_entries(entries: PiSessionTreeEntry[]) {
  let parent_id: string | null = null;

  return entries.map((entry) => {
    const chained_entry = { ...entry, parentId: parent_id };
    parent_id = entry.id;
    return chained_entry;
  });
}

function is_real_message_entry(entry: PiSessionTreeEntry) {
  return entry.type === 'message' && !entry.id.startsWith('compaction:');
}

function timestamp_for_entry(message: HarnessRunMessage) {
  const millis = timestamp_millis(message.created_time);
  return new Date(millis).toISOString();
}

function timestamp_millis(value: Date | string | null | undefined) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return Date.now();
}
