import { create } from 'zustand';
import {
  move_optimistic_user_message_to_session,
  remove_optimistic_user_message,
  remove_session_optimistic_user_messages,
} from '@/components/app/chat_optimistic_messages';
import type { RunMessage } from '@/lib/api';

type ChatOptimisticMessageState = {
  optimistic_user_messages: RunMessage[];
  add_optimistic_user_message: (message: RunMessage) => void;
  move_optimistic_user_message_to_session: (input: {
    client_message_id: string;
    session_id: string;
  }) => void;
  remove_optimistic_user_message: (client_message_id: string) => void;
  remove_session_optimistic_user_messages: (session_id: string) => void;
};

export const useChatOptimisticMessageStore = create<ChatOptimisticMessageState>((set) => ({
  optimistic_user_messages: [],
  add_optimistic_user_message: (message) =>
    set((state) => ({
      optimistic_user_messages: [
        ...remove_optimistic_user_message({
          client_message_id: message.run_message_id,
          messages: state.optimistic_user_messages,
        }),
        message,
      ],
    })),
  move_optimistic_user_message_to_session: (input) =>
    set((state) => ({
      optimistic_user_messages: move_optimistic_user_message_to_session({
        ...input,
        messages: state.optimistic_user_messages,
      }),
    })),
  remove_optimistic_user_message: (client_message_id) =>
    set((state) => ({
      optimistic_user_messages: remove_optimistic_user_message({
        client_message_id,
        messages: state.optimistic_user_messages,
      }),
    })),
  remove_session_optimistic_user_messages: (session_id) =>
    set((state) => ({
      optimistic_user_messages: remove_session_optimistic_user_messages({
        messages: state.optimistic_user_messages,
        session_id,
      }),
    })),
}));
