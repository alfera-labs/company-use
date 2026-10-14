import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Dispatch, type RefObject, type SetStateAction, useRef } from 'react';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import { useChatOptimisticMessageStore } from '@/components/app/chat_optimistic_message_store';
import {
  create_client_message_id,
  create_optimistic_user_message,
  merge_optimistic_user_messages,
  optimistic_pending_session_id,
  remove_optimistic_user_message as remove_optimistic_user_message_from,
} from '@/components/app/chat_optimistic_messages';
import { type SendChatDraft, send_chat_draft } from '@/components/app/chat_send_draft';
import { show_send_error } from '@/components/app/chat_send_error';
import type { ChatWallCode } from '@/components/app/use_chat_paywall';
import { useRunLastMessageAgain } from '@/components/app/use_run_last_message_again';
import type { RunMessage } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { useAuth } from '@/lib/auth_client';

type SendMomentState = {
  messages: RunMessage[];
  latest_run_id: string | undefined;
  refresh_queued_messages: () => Promise<unknown>;
};

type ChatSendMessageInput = {
  session_id: string | undefined;
  draft_key: string;
  on_session_ready: (session_id: string) => void;
  set_attachments: Dispatch<SetStateAction<PendingChatAttachment[]>>;
  set_wall_code: (code: ChatWallCode) => void;
  watch_for_resumed_run: () => void;
  read_send_moment_state: () => SendMomentState;
};

function useSignedInSender() {
  const { user } = useAuth();
  if (!user) return undefined;
  const display_name =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || '';
  return { user_id: user.id, display_name };
}

function useDraftClientMessageIds(draft_key: string) {
  const draft_client_message_id_ref = useRef<Record<string, string>>({});
  return {
    read: () => {
      const existing = draft_client_message_id_ref.current[draft_key];
      if (existing) return existing;
      const minted = create_client_message_id();
      draft_client_message_id_ref.current[draft_key] = minted;
      return minted;
    },
    forget: () => {
      delete draft_client_message_id_ref.current[draft_key];
    },
    remember: (client_message_id: string) => {
      draft_client_message_id_ref.current[draft_key] = client_message_id;
    },
  };
}

type SendCallbackContext = {
  input: ChatSendMessageInput;
  optimistic_message_by_client_id: Record<string, RunMessage>;
  run_id_before_send_ref: RefObject<string | undefined>;
  draft_client_message_ids: ReturnType<typeof useDraftClientMessageIds>;
  optimistic_user_messages: RunMessage[];
  signed_in_sender: { user_id: string; display_name: string } | undefined;
};

function show_draft_at_once(context: SendCallbackContext, draft: SendChatDraft) {
  const { input } = context;
  const moment = input.read_send_moment_state();
  const optimistic_message = create_optimistic_user_message({
    draft,
    messages: merge_optimistic_user_messages({
      messages: moment.messages,
      optimistic_messages: context.optimistic_user_messages,
      ...(input.session_id ? { selected_session_id: input.session_id } : {}),
    }),
    ...(context.signed_in_sender ? { sender: context.signed_in_sender } : {}),
    session_id: input.session_id ?? optimistic_pending_session_id(draft.client_message_id),
  });
  context.optimistic_message_by_client_id[draft.client_message_id] = optimistic_message;
  context.run_id_before_send_ref.current = moment.latest_run_id;
  context.draft_client_message_ids.forget();
  useChatDraftStore.getState().clear_draft(input.draft_key);
  input.set_attachments([]);
  useChatOptimisticMessageStore.getState().add_optimistic_user_message(optimistic_message);
}

function restore_failed_draft(context: SendCallbackContext, error: Error, draft: SendChatDraft) {
  const { input } = context;
  delete context.optimistic_message_by_client_id[draft.client_message_id];
  useChatOptimisticMessageStore.getState().remove_optimistic_user_message(draft.client_message_id);
  useChatDraftStore.getState().set_draft(input.draft_key, draft.message_text);
  context.draft_client_message_ids.remember(draft.client_message_id);
  input.set_attachments(draft.attachments);
  input.watch_for_resumed_run();
  show_send_error(error, input.set_wall_code);
}

function finish_sent_draft(context: SendCallbackContext, draft: SendChatDraft) {
  delete context.optimistic_message_by_client_id[draft.client_message_id];
  context.input.watch_for_resumed_run();
  void context.input.read_send_moment_state().refresh_queued_messages();
}

/** Sends a chat message: shows it at once, then creates the chat if needed and queues the run. */
export function useChatSendMessage(input: ChatSendMessageInput) {
  const query_client = useQueryClient();
  const optimistic_message_by_client_id_ref = useRef<Record<string, RunMessage>>({});
  const run_id_before_send_ref = useRef<string | undefined>(undefined);
  const draft_client_message_ids = useDraftClientMessageIds(input.draft_key);
  const optimistic_user_messages = useChatOptimisticMessageStore(
    (state) => state.optimistic_user_messages,
  );
  const context: SendCallbackContext = {
    input,
    optimistic_message_by_client_id: optimistic_message_by_client_id_ref.current,
    run_id_before_send_ref,
    draft_client_message_ids,
    optimistic_user_messages,
    signed_in_sender: useSignedInSender(),
  };
  const send_message = useMutation({
    mutationFn: (draft: SendChatDraft) =>
      send_chat_draft(
        {
          session_id: input.session_id,
          query_client,
          read_optimistic_message: (id) => optimistic_message_by_client_id_ref.current[id],
          move_optimistic_user_message_to_session:
            useChatOptimisticMessageStore.getState().move_optimistic_user_message_to_session,
          on_session_ready: input.on_session_ready,
        },
        draft,
      ),
    onMutate: (draft) => show_draft_at_once(context, draft),
    onError: (error, draft) => restore_failed_draft(context, error, draft),
    onSuccess: (_session_id, draft) => finish_sent_draft(context, draft),
  });
  return {
    send_message,
    run_id_before_send_ref,
    client_message_id_for_draft: draft_client_message_ids.read,
    run_again: useRunLastMessageAgain(input, run_id_before_send_ref),
  };
}

/** Removes the own copy of a message from the chat, both from the store and from the cache. */
export function useForgetOptimisticMessage(session_id: string | undefined) {
  const query_client = useQueryClient();
  const remove_optimistic_user_message = useChatOptimisticMessageStore(
    (state) => state.remove_optimistic_user_message,
  );
  return (client_message_id: string) => {
    remove_optimistic_user_message(client_message_id);
    if (!session_id) return;
    query_client.setQueryData<RunMessage[]>(query_keys.messages(session_id), (messages) =>
      remove_optimistic_user_message_from({ client_message_id, messages: messages ?? [] }),
    );
  };
}
