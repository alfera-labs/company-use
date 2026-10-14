import type { QueryClient } from '@tanstack/react-query';
import { create_chat_message_payload } from '@/components/app/chat_file_parts';
import {
  add_session_optimistic_user_message,
  type OptimisticChatMessageDraft,
  remove_optimistic_user_message,
} from '@/components/app/chat_optimistic_messages';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { written_message_model } from '@/components/app/model_picker/model_choice';
import {
  create_session,
  type RunMessage,
  type Session,
  send_queued_session_message,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

/** A chat message the person sends, with the project for a new chat. */
export type SendChatDraft = OptimisticChatMessageDraft & { project_id?: string | null };

/** What sending a draft needs from the chat view at the moment it sends. */
export type SendChatDraftContext = {
  session_id: string | undefined;
  query_client: QueryClient;
  read_optimistic_message: (client_message_id: string) => RunMessage | undefined;
  move_optimistic_user_message_to_session: (input: {
    client_message_id: string;
    session_id: string;
  }) => void;
  on_session_ready: (session_id: string) => void;
};

async function create_chat_session(query_client: QueryClient, project_id?: string | null) {
  const session = await create_session(project_id ? { project_id } : {});
  const session_id = session.session_id;
  query_client.setQueryData<Session[]>(query_keys.sessions(), (sessions) => [
    { ...session, session_status: 'running' },
    ...(sessions ?? []),
  ]);
  query_client.setQueryData(query_keys.runs(session_id), []);
  query_client.setQueryData(query_keys.tool_calls(session_id), []);
  query_client.setQueryData(query_keys.sandbox_previews(session_id), []);
  query_client.setQueryData(query_keys.queued_messages(session_id), []);
  query_client.setQueryData(query_keys.open_choices_wait(session_id), null);
  return session_id;
}

function show_optimistic_message_in_session(
  context: SendChatDraftContext,
  draft: SendChatDraft,
  session_id: string,
) {
  const optimistic_message = context.read_optimistic_message(draft.client_message_id);
  context.move_optimistic_user_message_to_session({
    client_message_id: draft.client_message_id,
    session_id,
  });
  if (!optimistic_message) return;
  context.query_client.setQueryData<RunMessage[]>(query_keys.messages(session_id), (messages) =>
    add_session_optimistic_user_message({ messages, optimistic_message, session_id }),
  );
}

function remove_unsent_message(
  query_client: QueryClient,
  session_id: string,
  client_message_id: string,
) {
  query_client.setQueryData<RunMessage[]>(query_keys.messages(session_id), (messages) =>
    remove_optimistic_user_message({ client_message_id, messages: messages ?? [] }),
  );
}

/** Creates the chat when it is new, shows the message in it, and queues the message to run. */
export async function send_chat_draft(context: SendChatDraftContext, draft: SendChatDraft) {
  let target_session_id = context.session_id;
  try {
    const resolved_session_id =
      target_session_id ?? (await create_chat_session(context.query_client, draft.project_id));
    target_session_id = resolved_session_id;
    show_optimistic_message_in_session(context, draft, resolved_session_id);
    if (!context.session_id) context.on_session_ready(resolved_session_id);
    await send_queued_session_message(resolved_session_id, {
      ...create_chat_message_payload({
        ...draft,
        model: written_message_model(useChatUiStore.getState().model_choice),
      }),
      client_message_id: draft.client_message_id,
    });
    return resolved_session_id;
  } catch (error) {
    if (target_session_id) {
      remove_unsent_message(context.query_client, target_session_id, draft.client_message_id);
    }
    throw error;
  }
}
