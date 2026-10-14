import { useEffect, useMemo } from 'react';
import { useChatOptimisticMessageStore } from '@/components/app/chat_optimistic_message_store';
import {
  confirmed_client_message_ids,
  merge_optimistic_user_messages,
} from '@/components/app/chat_optimistic_messages';
import type { QueuedChatMessage } from '@/components/app/chat_queued_messages';
import { find_visible_chat_messages } from '@/components/app/chat_timeline';
import { queued_messages_not_in_transcript } from '@/components/app/use_queued_chat_messages';
import type { RunMessage } from '@/lib/api';

type ChatTranscriptInput = {
  session_id: string | undefined;
  saved_messages: RunMessage[] | undefined;
  unconfirmed_messages: RunMessage[];
  queued: { queued_messages: QueuedChatMessage[]; queued_client_message_ids: ReadonlySet<string> };
};

function useForgetConfirmedMessages(
  persisted_session_messages: RunMessage[],
  unconfirmed_messages: RunMessage[],
) {
  const remove_optimistic_user_message = useChatOptimisticMessageStore(
    (state) => state.remove_optimistic_user_message,
  );
  useEffect(() => {
    const confirmed_ids = confirmed_client_message_ids(persisted_session_messages);
    for (const message of unconfirmed_messages) {
      if (confirmed_ids.has(message.run_message_id))
        remove_optimistic_user_message(message.run_message_id);
    }
  }, [persisted_session_messages, remove_optimistic_user_message, unconfirmed_messages]);
}

/** Merges saved messages, own unsent copies, and queued messages into one bubble per message. */
export function useChatTranscript(input: ChatTranscriptInput) {
  const { session_id, saved_messages, queued } = input;
  const optimistic_user_messages = useChatOptimisticMessageStore(
    (state) => state.optimistic_user_messages,
  );
  const persisted_session_messages = useMemo(() => saved_messages ?? [], [saved_messages]);
  const session_messages = useMemo(
    () =>
      merge_optimistic_user_messages({
        messages: persisted_session_messages,
        optimistic_messages: optimistic_user_messages,
        ...(session_id ? { selected_session_id: session_id } : {}),
        hidden_client_message_ids: queued.queued_client_message_ids,
      }),
    [
      optimistic_user_messages,
      persisted_session_messages,
      queued.queued_client_message_ids,
      session_id,
    ],
  );
  const queued_messages = useMemo(
    () => queued_messages_not_in_transcript(queued.queued_messages, persisted_session_messages),
    [persisted_session_messages, queued.queued_messages],
  );
  useForgetConfirmedMessages(persisted_session_messages, input.unconfirmed_messages);
  const visible_messages = useMemo(
    () => find_visible_chat_messages(session_messages),
    [session_messages],
  );
  return { session_messages, queued_messages, visible_messages };
}
