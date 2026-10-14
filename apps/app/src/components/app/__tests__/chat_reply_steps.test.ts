import { describe, expect, it } from 'vitest';
import { entries_people_see } from '@/components/app/chat_reply_steps';

describe('the steps people see in a chat', () => {
  it('hides the reply tool step, keeps the reply text and every other step', () => {
    const entries = [
      {
        sequence: 1,
        message: {
          parts: [
            { type: 'tool-call', toolName: 'files-read-1' },
            { type: 'tool-call', toolName: 'chat-respond-1' },
          ],
        },
      },
      { sequence: 2, message: { parts: [{ type: 'text', text: 'Done.' }] } },
      { sequence: 3, message: { parts: [{ type: 'tool-call', toolName: 'chat-respond-1' }] } },
    ];

    expect(entries_people_see(entries)).toEqual([
      { sequence: 1, message: { parts: [{ type: 'tool-call', toolName: 'files-read-1' }] } },
      { sequence: 2, message: { parts: [{ type: 'text', text: 'Done.' }] } },
    ]);
  });
});
