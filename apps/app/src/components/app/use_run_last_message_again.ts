import { useMutation } from '@tanstack/react-query';
import type { RefObject } from 'react';
import { create_client_message_id } from '@/components/app/chat_optimistic_messages';
import { show_send_error } from '@/components/app/chat_send_error';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { written_message_model } from '@/components/app/model_picker/model_choice';
import type { ChatWallCode } from '@/components/app/use_chat_paywall';
import type { RunMessage } from '@/lib/api';
import { repeat_queued_session_message } from '@/lib/api/repeat_message';

type RunAgainInput = {
  session_id: string | undefined;
  set_wall_code: (code: ChatWallCode) => void;
  watch_for_resumed_run: () => void;
  read_send_moment_state: () => {
    messages: RunMessage[];
    latest_run_id: string | undefined;
    refresh_queued_messages: () => Promise<unknown>;
  };
};

/** The last message a person sent that the chat shows and the API has stored. */
export function last_stored_user_message(messages: readonly RunMessage[]) {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.message_role === 'user' &&
        message.is_user_visible !== false &&
        message.source_metadata?.optimistic !== true,
    );
}

/**
 * Runs the last message of the chat again. The API reads the stored message, so the chat gets a
 * new answer and keeps the one message the person sent. The queue is read again inside the
 * request, so the chat says "Working" with no gap between the request and the queued message.
 */
export function useRunLastMessageAgain(
  input: RunAgainInput,
  run_id_before_send_ref: RefObject<string | undefined>,
) {
  const repeat = useMutation({
    mutationFn: async (run_message_id: string) => {
      await repeat_queued_session_message(input.session_id ?? '', {
        run_message_id,
        client_message_id: create_client_message_id(),
        ...written_message_model(useChatUiStore.getState().model_choice),
      });
      await input.read_send_moment_state().refresh_queued_messages();
    },
    onMutate: () => {
      run_id_before_send_ref.current = input.read_send_moment_state().latest_run_id;
      input.watch_for_resumed_run();
    },
    onError: (error) => show_send_error(error, input.set_wall_code),
  });
  function run() {
    const message = last_stored_user_message(input.read_send_moment_state().messages);
    if (input.session_id && message && !repeat.isPending) repeat.mutate(message.run_message_id);
  }
  return { run, is_pending: repeat.isPending };
}
