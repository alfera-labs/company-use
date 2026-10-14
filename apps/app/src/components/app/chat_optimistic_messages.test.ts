import { describe, expect, it } from 'vitest';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import {
  add_session_optimistic_user_message,
  create_optimistic_user_message,
  merge_optimistic_user_messages,
  move_optimistic_user_message_to_session,
  optimistic_pending_session_id,
  remove_optimistic_user_message,
  remove_session_optimistic_user_messages,
} from '@/components/app/chat_optimistic_messages';
import { create_projected_chat_messages } from '@/components/app/chat_stream_projection';
import type { RunMessage } from '@/lib/api';

describe('optimistic chat messages', () => {
  it('creates a user-visible message before the server stream replies', () => {
    const message = create_optimistic_user_message({
      draft: {
        attachments: [],
        client_message_id: 'client_msg_1',
        message_text: 'Start the invoice workflow.',
      },
      messages: [],
      session_id: optimistic_pending_session_id('client_msg_1'),
      time: '2026-06-24T10:00:00.000Z',
    });

    const projected_messages = create_projected_chat_messages({
      messages: [message],
      tool_calls: [],
    });

    expect(projected_messages).toEqual([
      {
        id: 'client_msg_1',
        parts: [{ text: 'Start the invoice workflow.', type: 'text' }],
        role: 'user',
        sent_time: '2026-06-24T10:00:00.000Z',
      },
    ]);
  });

  it('names the sender it was given', () => {
    const message = create_optimistic_user_message({
      draft: {
        attachments: [],
        client_message_id: 'client_msg_named',
        message_text: 'Check Gmail.',
      },
      messages: [],
      sender: { user_id: 'user_2', display_name: 'Robin Tate' },
      session_id: 'session_1',
      time: '2026-06-24T10:00:00.000Z',
    });

    const projected_messages = create_projected_chat_messages({
      messages: [message],
      tool_calls: [],
    });

    expect(projected_messages[0]?.sender).toMatchObject({
      source_actor_id: 'platform:user_2',
      display_name: 'Robin Tate',
    });
  });

  it('shows the attachment as a chip when the draft has no text', () => {
    const message = create_optimistic_user_message({
      draft: {
        attachments: [pending_file_attachment()],
        client_message_id: 'client_msg_file',
        message_text: '',
      },
      messages: [],
      session_id: 'session_1',
      time: '2026-06-24T10:00:00.000Z',
    });

    const projected_messages = create_projected_chat_messages({
      messages: [message],
      tool_calls: [],
    });

    expect(projected_messages[0]?.parts).toEqual([
      { type: 'file', name: 'leads.csv', mimeType: 'text/csv', isInlineText: true },
    ]);
  });

  it('moves, merges, and removes the temporary message by client id', () => {
    const optimistic_message = create_optimistic_user_message({
      draft: {
        attachments: [],
        client_message_id: 'client_msg_2',
        message_text: 'Check Gmail.',
      },
      messages: [persisted_user_message({ run_message_id: 'existing', sequence: 1 })],
      session_id: optimistic_pending_session_id('client_msg_2'),
      time: '2026-06-24T10:00:00.000Z',
    });
    const moved_messages = move_optimistic_user_message_to_session({
      client_message_id: 'client_msg_2',
      messages: [optimistic_message],
      session_id: 'session_1',
    });

    expect(moved_messages[0]?.session_id).toBe('session_1');
    expect(
      merge_optimistic_user_messages({
        messages: [persisted_user_message({ run_message_id: 'existing', sequence: 1 })],
        optimistic_messages: moved_messages,
        selected_session_id: 'session_1',
      }).map((message) => message.run_message_id),
    ).toEqual(['existing', 'client_msg_2']);
    expect(
      add_session_optimistic_user_message({
        messages: undefined,
        optimistic_message,
        session_id: 'session_1',
      }).map((message) => [message.run_message_id, message.session_id]),
    ).toEqual([['client_msg_2', 'session_1']]);
    expect(
      remove_optimistic_user_message({
        client_message_id: 'client_msg_2',
        messages: moved_messages,
      }),
    ).toEqual([]);
    expect(
      remove_session_optimistic_user_messages({
        messages: moved_messages,
        session_id: 'session_1',
      }),
    ).toEqual([]);
  });

  it('draws a queued draft as a queued bubble, then in the transcript until its row exists', () => {
    const persisted = [persisted_user_message({ run_message_id: 'existing', sequence: 1 })];
    const optimistic_message = create_optimistic_user_message({
      draft: { attachments: [], client_message_id: 'client_msg_3', message_text: 'Then this.' },
      messages: persisted,
      session_id: 'session_1',
    });
    const shown_ids = (input: {
      messages: RunMessage[];
      hidden_client_message_ids?: ReadonlySet<string>;
    }) =>
      merge_optimistic_user_messages({
        ...input,
        optimistic_messages: [optimistic_message],
        selected_session_id: 'session_1',
      }).map((message) => message.run_message_id);

    expect(
      shown_ids({ messages: persisted, hidden_client_message_ids: new Set(['client_msg_3']) }),
    ).toEqual(['existing']);
    expect(shown_ids({ messages: persisted })).toEqual(['existing', 'client_msg_3']);
    const confirmed = {
      ...persisted_user_message({ run_message_id: 'msg_server', sequence: 2 }),
      source_metadata: { client_message_id: 'client_msg_3' },
    } as RunMessage;
    expect(shown_ids({ messages: [...persisted, optimistic_message, confirmed] })).toEqual([
      'existing',
      'msg_server',
    ]);
  });
});

function pending_file_attachment(): PendingChatAttachment {
  return {
    byte_size: 1024,
    id: 'attachment_1',
    mime_type: 'text/csv',
    name: 'leads.csv',
    upload_progress: 1,
    upload_status: 'ready',
    part: {
      mime_type: 'text/csv',
      name: 'leads.csv',
      text: 'name,email',
      type: 'file',
    },
  };
}

function persisted_user_message(input: { run_message_id: string; sequence: number }) {
  return {
    created_time: '2026-06-24T09:00:00.000Z',
    is_model_visible: true,
    is_user_visible: true,
    last_updated_time: '2026-06-24T09:00:00.000Z',
    message_content: { text: 'Existing message.', type: 'text' },
    message_kind: 'input',
    message_role: 'user',
    message_sequence: input.sequence,
    run_id: 'run_1',
    run_message_id: input.run_message_id,
    run_message_sequence: input.sequence,
    session_id: 'session_1',
    workspace_id: 'workspace_1',
  } as unknown as RunMessage;
}
