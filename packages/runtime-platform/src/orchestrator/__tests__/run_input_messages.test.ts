import { describe_message_text_file } from '@runtime-platform/attachments/message_text_file';
import { build_run_input_messages } from '@runtime-platform/orchestrator/run_input_messages';
import { describe, expect, it } from 'vitest';

const run_input = { workspace_id: 'ws_1', session_id: 'ses_1', actor_id: 'user_1' };

describe('the stored message of a person', () => {
  it('keeps a note for the model out of the text the person sees', () => {
    const typed = 'name | company\n'.repeat(200).trim();
    const notes = describe_message_text_file({
      path: '/workspace/tmp/message.md',
      byte_count: 3000,
    });

    const [message] = build_run_input_messages(
      run_input,
      'run_1',
      [{ type: 'text', text: typed }],
      notes,
    );

    expect(message?.message_content).toEqual({
      type: 'text',
      text: typed,
      parts: [
        { type: 'text', text: typed },
        {
          type: 'text',
          text: 'The message above is also saved as a file at /workspace/tmp/message.md (3000 bytes). When it holds data to move — rows, records, a list — read it from there with a script; do not retype it by hand.',
        },
      ],
    });
  });

  it('stores a message with no note as before', () => {
    const [message] = build_run_input_messages(run_input, 'run_1', [{ type: 'text', text: 'hi' }]);

    expect(message?.message_content).toEqual({
      type: 'text',
      text: 'hi',
      parts: [{ type: 'text', text: 'hi' }],
    });
  });
});
