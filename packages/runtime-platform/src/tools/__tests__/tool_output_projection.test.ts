import { project_tool_output } from '@runtime-platform/tools/tool_output_projection';
import { describe, expect, it } from 'vitest';

describe('project_tool_output', () => {
  it('keeps requested fields on list items without losing the response envelope', () => {
    const output = {
      node_key: 'gmail-find_email-1',
      output: {
        ret: [
          {
            id: 'message_1',
            sender: 'sales@example.com',
            subject: 'Pricing',
            snippet: 'A very large body',
            labelIds: ['INBOX', 'UNREAD'],
          },
        ],
        exports: { $summary: 'Found 1 message' },
      },
    };

    expect(project_tool_output(output, ['id', 'sender', 'subject', 'labelIds'])).toEqual({
      node_key: 'gmail-find_email-1',
      output: {
        ret: [
          {
            id: 'message_1',
            sender: 'sales@example.com',
            subject: 'Pricing',
            labelIds: ['INBOX', 'UNREAD'],
          },
        ],
      },
    });
  });

  it('removes large sibling fields from nested list responses', () => {
    const output = {
      node_key: 'slack-list_channels-1',
      output: {
        ret: {
          channels: [{ id: 'C123', name: 'general', topic: 'A large topic' }],
          raw: 'x'.repeat(10_000),
        },
      },
    };

    expect(project_tool_output(output, ['id', 'name'])).toEqual({
      node_key: 'slack-list_channels-1',
      output: { ret: { channels: [{ id: 'C123', name: 'general' }] } },
    });
  });

  it('returns the full result when none of the requested fields exist', () => {
    const output = { node_key: 'gmail-find_email-1', output: { ret: [{ subject: 'Hello' }] } };

    expect(project_tool_output(output, ['id'])).toBe(output);
  });
});
