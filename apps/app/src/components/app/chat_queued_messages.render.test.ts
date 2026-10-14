import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  create_optimistic_user_message,
  merge_optimistic_user_messages,
} from '@/components/app/chat_optimistic_messages';
import { ChatQueuedMessages, type QueuedChatMessage } from '@/components/app/chat_queued_messages';
import {
  client_message_ids_drawn_as_own_bubbles,
  queued_messages_not_in_transcript,
} from '@/components/app/use_queued_chat_messages';
import type { RunMessage } from '@/lib/api';

const not_sent: QueuedChatMessage = {
  job_id: 'ejob_not_sent',
  client_message_id: 'client:not_sent',
  preview_text: 'Summarize the contract.',
  attachment_count: 1,
  created_time: '2026-09-26T10:00:00.000Z',
  state: 'not_sent',
  reason_code: 'attachment_unavailable',
  reason: 'An attachment is no longer available',
  retry_message: { message: 'Summarize the contract.' },
};

function render(messages: QueuedChatMessage[]) {
  return renderToStaticMarkup(
    createElement(ChatQueuedMessages, {
      messages,
      isSendingNow: false,
      onRemove: () => undefined,
      onRetry: () => undefined,
      onSendNow: () => undefined,
    }),
  );
}

describe('a chat message that was not sent', () => {
  it('shows the words, "Not sent", the reason, Retry and Remove', () => {
    const html = render([not_sent]);

    expect(html).toContain('Summarize the contract.');
    expect(html).toContain('Not sent');
    expect(html).toContain('An attachment is no longer available');
    expect(html).toContain('Retry');
    expect(html).toContain('Remove');
  });

  it('offers no Retry when the message itself could not be read', () => {
    const html = render([
      {
        ...not_sent,
        reason_code: 'could_not_be_read',
        reason: 'The message could not be read',
        retry_message: null,
      },
    ]);

    expect(html).not.toContain('Retry');
    expect(html).toContain('Remove');
  });

  it("replaces the tab's own copy of the message in the transcript, never beside it", () => {
    const own_copy = create_optimistic_user_message({
      draft: { attachments: [], client_message_id: 'client:not_sent', message_text: 'Summarize' },
      messages: [],
      session_id: 'ses_1',
    });

    const transcript = merge_optimistic_user_messages({
      messages: [],
      optimistic_messages: [own_copy],
      selected_session_id: 'ses_1',
      hidden_client_message_ids: client_message_ids_drawn_as_own_bubbles([not_sent]),
    });

    expect(transcript).toEqual([]);
  });
});

describe('a queued chat message', () => {
  const queued: QueuedChatMessage = {
    job_id: 'ejob_queued',
    client_message_id: 'client:queued',
    preview_text: 'Draft the reply.',
    attachment_count: 0,
    created_time: '2026-09-26T10:00:00.000Z',
    state: 'queued',
    waiting_reason: 'session_busy',
  };

  it('looks sent when nothing holds it back, and says "Queued" while the chat is busy', () => {
    const starting = render([{ ...queued, waiting_reason: 'starting' }]);
    expect(starting).toContain('Draft the reply.');
    expect(starting).not.toContain('>Queued<');
    expect(starting).not.toContain('opacity-60');
    expect(render([queued])).toContain('Queued');
  });

  const started_message: RunMessage = {
    ...create_optimistic_user_message({
      draft: { attachments: [], client_message_id: 'msg_1', message_text: 'Draft the reply.' },
      messages: [],
      session_id: 'ses_1',
    }),
    run_id: 'run_1',
    run_message_id: 'msg_1',
    source_metadata: { client_message_id: 'client:queued' },
  };

  it('draws nothing once the transcript has the message with the same draft id', () => {
    const shown = queued_messages_not_in_transcript(
      [{ ...queued, waiting_reason: 'starting' }],
      [started_message],
    );

    expect(shown).toEqual([]);
    expect(render(shown)).toBe('');
  });

  it('draws nothing once the transcript has the run the message started', () => {
    const shown = queued_messages_not_in_transcript(
      [{ ...queued, client_message_id: null, run_id: 'run_1' }],
      [{ ...started_message, source_metadata: {} }],
    );

    expect(shown).toEqual([]);
  });

  it('keeps a message the transcript does not have yet', () => {
    const other = { ...queued, job_id: 'ejob_other', client_message_id: 'client:other' };
    expect(queued_messages_not_in_transcript([other], [started_message])).toEqual([other]);
  });
});
