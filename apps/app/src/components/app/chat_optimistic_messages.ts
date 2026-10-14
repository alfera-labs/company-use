import { create_platform_source_actor } from '@coworker/shared';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import {
  is_own_unconfirmed_copy as is_optimistic_user_message,
  stored_messages_then_own_copies,
} from '@/components/app/chat_own_copy_order';
import type { RunMessage } from '@/lib/api';
import { create_random_id } from '@/lib/random_id';

export type OptimisticChatMessageDraft = {
  attachments: PendingChatAttachment[];
  client_message_id: string;
  message_text: string;
};

const optimistic_source_metadata = {
  client_visible: true,
  optimistic: true,
};

export function create_optimistic_user_message(input: {
  draft: OptimisticChatMessageDraft;
  messages: RunMessage[];
  sender?: { user_id: string; display_name: string };
  session_id: string;
  time?: string;
}) {
  const time = input.time ?? new Date().toISOString();
  const sequence = next_message_sequence(input.messages);

  const message_content = optimistic_message_content(input.draft);

  return {
    content_json: null,
    content_text: message_content.text ?? null,
    created_by: 'client',
    created_time: time,
    is_model_visible: true,
    is_user_visible: true,
    last_updated_by: 'client',
    last_updated_time: time,
    message_content,
    message_kind: 'input',
    message_role: 'user',
    message_sequence: sequence,
    metadata: {},
    provider_call_id: null,
    provider_item_id: null,
    run_id: optimistic_run_id(input.draft.client_message_id),
    run_message_id: input.draft.client_message_id,
    run_message_sequence: sequence,
    session_id: input.session_id,
    source_metadata: {
      ...optimistic_source_metadata,
      ...(input.sender
        ? {
            source_actor: create_platform_source_actor({
              platform_user_id: input.sender.user_id,
              profile: { display_name: input.sender.display_name },
            }),
          }
        : {}),
    },
    source_type: 'dashboard',
    token_count: null,
    tool_call_id: null,
    workspace_id: 'optimistic',
  } as unknown as RunMessage;
}

export function merge_optimistic_user_messages(input: {
  messages: RunMessage[];
  optimistic_messages: RunMessage[];
  selected_session_id?: string | undefined;
  hidden_client_message_ids?: ReadonlySet<string> | undefined;
}) {
  const confirmed_ids = confirmed_client_message_ids(input.messages);
  const is_shown = (message: RunMessage) =>
    !confirmed_ids.has(message.run_message_id) &&
    !input.hidden_client_message_ids?.has(message.run_message_id);
  const messages = input.messages.filter(
    (message) => !is_optimistic_user_message(message) || is_shown(message),
  );
  const visible_optimistic_messages = input.optimistic_messages.filter((message) =>
    input.selected_session_id ? message.session_id === input.selected_session_id : true,
  );
  const persisted_message_ids = new Set(messages.map((message) => message.run_message_id));
  const pending_messages = visible_optimistic_messages.filter(
    (message) => !persisted_message_ids.has(message.run_message_id) && is_shown(message),
  );

  return stored_messages_then_own_copies([...messages, ...pending_messages]);
}

export function confirmed_client_message_ids(messages: readonly RunMessage[]) {
  return new Set(
    messages.flatMap((message) => {
      if (message.message_role !== 'user' || is_optimistic_user_message(message)) return [];
      const client_message_id = message.source_metadata?.client_message_id;
      return typeof client_message_id === 'string' ? [client_message_id] : [];
    }),
  );
}

export function move_optimistic_user_message_to_session(input: {
  client_message_id: string;
  messages: RunMessage[];
  session_id: string;
}) {
  return input.messages.map((message) =>
    message.run_message_id === input.client_message_id
      ? { ...message, session_id: input.session_id }
      : message,
  );
}

export function add_session_optimistic_user_message(input: {
  messages: RunMessage[] | undefined;
  optimistic_message: RunMessage;
  session_id: string;
}) {
  return merge_optimistic_user_messages({
    messages: input.messages ?? [],
    optimistic_messages: [{ ...input.optimistic_message, session_id: input.session_id }],
    selected_session_id: input.session_id,
  });
}

export function remove_optimistic_user_message(input: {
  client_message_id: string;
  messages: RunMessage[];
}) {
  return input.messages.filter((message) => message.run_message_id !== input.client_message_id);
}

export function remove_session_optimistic_user_messages(input: {
  messages: RunMessage[];
  session_id: string;
}) {
  return input.messages.filter(
    (message) => !(message.session_id === input.session_id && is_optimistic_user_message(message)),
  );
}

export function create_client_message_id() {
  return `client:${create_random_id()}`;
}

export function optimistic_pending_session_id(client_message_id: string) {
  return `pending:${client_message_id}`;
}

function optimistic_message_content(draft: OptimisticChatMessageDraft) {
  const text = draft.message_text.trim();
  const parts = [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...draft.attachments.map(optimistic_attachment_part),
  ];

  return {
    ...(text ? { text } : {}),
    type: 'text',
    ...(parts.length > 0 ? { parts } : {}),
  };
}

function optimistic_attachment_part(attachment: PendingChatAttachment) {
  if (attachment.part?.type === 'image') {
    return {
      type: 'image' as const,
      data: attachment.part.data,
      mime_type: attachment.mime_type,
      source: attachment.name,
    };
  }

  if (attachment.part?.type === 'file') {
    return { ...attachment.part, mime_type: attachment.mime_type, name: attachment.name };
  }

  return {
    type: 'file' as const,
    mime_type: attachment.mime_type,
    name: attachment.name,
  };
}

function next_message_sequence(messages: RunMessage[]) {
  const sequences = messages.map((message) => Number(message.message_sequence ?? 0));
  return Math.max(0, ...sequences) + 1;
}

function optimistic_run_id(client_message_id: string) {
  return `optimistic:${client_message_id}`;
}
