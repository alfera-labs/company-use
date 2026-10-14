// @vitest-environment happy-dom

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TypedMessageText } from '@/components/app/chat_message';
import { create_projected_chat_messages } from '@/components/app/chat_stream_projection';
import { read_chat_message_text } from '@/components/app/chat_timeline';
import type { RunMessage } from '@/lib/api';

const typed = 'name | company\n'.repeat(200).trim();
const note =
  'The message above is also saved as a file at /workspace/tmp/message.md (3000 bytes). When it holds data to move — rows, records, a list — read it from there with a script; do not retype it by hand.';

type StoredContent = RunMessage['message_content'];

function user_message(message_content: StoredContent) {
  return {
    created_time: '2026-06-16T00:00:00.000Z',
    is_user_visible: true,
    message_content,
    message_role: 'user',
    message_sequence: 1,
    run_id: 'run_1',
    run_message_id: 'msg_user',
    session_id: 'ses_1',
    source_metadata: {},
  } as RunMessage;
}

function shown_in_the_bubble(message_content: StoredContent) {
  const [message] = create_projected_chat_messages({
    messages: [user_message(message_content)],
    tool_calls: [],
  });
  const text = message?.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []));
  const bubble = document.createElement('div');
  bubble.innerHTML = renderToStaticMarkup(
    createElement(TypedMessageText, { text: text?.join('') ?? '' }),
  );
  return bubble.textContent;
}

describe('the note for the model after a long message', () => {
  it('is not in the bubble of a message stored with the note in its text', () => {
    const stored_before_the_fix: StoredContent = {
      type: 'text',
      text: `${typed}\n${note}`,
      parts: [
        { type: 'text', text: typed },
        { type: 'text', text: note },
      ],
    };

    expect(read_chat_message_text(stored_before_the_fix)).toBe(typed);
    expect(shown_in_the_bubble(stored_before_the_fix)).toBe(typed);
  });

  it('is not in the bubble of a message that also carries a file', () => {
    const with_a_file: StoredContent = {
      type: 'multimodal',
      text: typed,
      parts: [
        { type: 'text', text: typed },
        { type: 'file', file_id: 'art_1', name: 'leads.csv', mime_type: 'text/csv' },
        { type: 'text', text: note },
      ],
    };

    expect(shown_in_the_bubble(with_a_file)).toBe(typed);
  });

  it('leaves a message that only talks about a file alone', () => {
    const text = 'The message above is also saved as a file, right?';

    expect(read_chat_message_text({ type: 'text', text })).toBe(text);
  });
});
