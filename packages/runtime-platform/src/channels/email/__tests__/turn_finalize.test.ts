import {
  email_turn_was_resolved,
  recover_failed_reply_text,
  recover_final_assistant_text,
} from '@runtime-platform/channels/email/turn_finalize';
import { describe, expect, it } from 'vitest';

const completed_reply = {
  tool_name: 'email-respond-1',
  tool_status: 'completed',
  input_data: { resolution_type: 'reply', message: 'Answer sent.' },
};

function assistant_output(text: string, is_user_visible = true) {
  return {
    message_role: 'assistant',
    message_kind: 'output',
    is_user_visible,
    content_text: text,
  };
}

describe('email_turn_was_resolved', () => {
  it('is resolved by a completed email reply', () => {
    expect(email_turn_was_resolved([completed_reply])).toBe(true);
  });

  it('is unresolved when the reply failed or never happened', () => {
    expect(email_turn_was_resolved([])).toBe(false);
    expect(email_turn_was_resolved([{ ...completed_reply, tool_status: 'failed' }])).toBe(false);
  });
});

describe('recover_failed_reply_text', () => {
  it('recovers the text of a reply whose send failed', () => {
    expect(recover_failed_reply_text([{ ...completed_reply, tool_status: 'failed' }])).toBe(
      'Answer sent.',
    );
  });

  it('returns null when every reply completed or none exists', () => {
    expect(recover_failed_reply_text([completed_reply])).toBeNull();
    expect(recover_failed_reply_text([])).toBeNull();
  });
});

describe('recover_final_assistant_text', () => {
  it('recovers the last user-visible assistant output', () => {
    expect(
      recover_final_assistant_text([
        assistant_output('First thought'),
        assistant_output('Final answer'),
      ]),
    ).toBe('Final answer');
  });

  it('never publishes user-invisible drafts', () => {
    expect(recover_final_assistant_text([assistant_output('Private draft', false)])).toBeNull();
  });
});
