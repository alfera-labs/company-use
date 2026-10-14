import { beforeEach, describe, expect, it } from 'vitest';
import { useChatOptimisticMessageStore } from '@/components/app/chat_optimistic_message_store';
import {
  create_optimistic_user_message,
  merge_optimistic_user_messages,
  optimistic_pending_session_id,
} from '@/components/app/chat_optimistic_messages';

describe('chat optimistic message store', () => {
  beforeEach(() => {
    useChatOptimisticMessageStore.setState({ optimistic_user_messages: [] });
  });

  it('keeps a first prompt visible across the new-session route transition', () => {
    const message = create_optimistic_user_message({
      draft: {
        attachments: [],
        client_message_id: 'client_msg_1',
        message_text: 'Build the Gmail follow-up workflow.',
      },
      messages: [],
      session_id: optimistic_pending_session_id('client_msg_1'),
      time: '2026-06-24T10:00:00.000Z',
    });

    useChatOptimisticMessageStore.getState().add_optimistic_user_message(message);
    useChatOptimisticMessageStore.getState().move_optimistic_user_message_to_session({
      client_message_id: 'client_msg_1',
      session_id: 'session_1',
    });

    const visible_messages = merge_optimistic_user_messages({
      messages: [],
      optimistic_messages: useChatOptimisticMessageStore.getState().optimistic_user_messages,
      selected_session_id: 'session_1',
    });

    expect(visible_messages.map((item) => [item.run_message_id, item.session_id])).toEqual([
      ['client_msg_1', 'session_1'],
    ]);

    useChatOptimisticMessageStore.getState().remove_session_optimistic_user_messages('session_1');

    expect(useChatOptimisticMessageStore.getState().optimistic_user_messages).toEqual([]);
  });
});
