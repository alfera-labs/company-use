import {
  type SlackTurnRecoveryMessage,
  select_slack_turn_recovered_reply,
  slack_turn_was_resolved,
} from '@runtime-platform/channels/slack/turn_resolution';
import { describe, expect, it } from 'vitest';

const turn_channel_id = 'C123';

describe('slack_turn_was_resolved', () => {
  it('treats a completed slack-respond-1 reply as resolved', () => {
    expect(
      slack_turn_was_resolved({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-respond-1',
            tool_status: 'completed',
            input_data: { resolution_type: 'reply', message: 'Here you go.' },
          },
        ],
      }),
    ).toBe(true);
  });

  it('keeps historical no_reply tool calls resolved during recovery', () => {
    expect(
      slack_turn_was_resolved({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-respond-1',
            tool_status: 'completed',
            input_data: { resolution_type: 'no_reply' },
          },
        ],
      }),
    ).toBe(true);
  });

  it('treats a failed slack-respond-1 as unresolved so a silent send is caught', () => {
    expect(
      slack_turn_was_resolved({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-respond-1',
            tool_status: 'failed',
            input_data: { resolution_type: 'reply', message: 'Here you go.' },
          },
        ],
      }),
    ).toBe(false);
  });

  it('treats a run that never called a reply tool as unresolved', () => {
    expect(
      slack_turn_was_resolved({
        turn_channel_id,
        tool_calls: [
          { tool_name: 'memory/remember', tool_status: 'completed', input_data: {} },
          { tool_name: 'browser/open', tool_status: 'completed', input_data: {} },
        ],
      }),
    ).toBe(false);
  });

  it('treats a direct send to the turn channel as resolved', () => {
    expect(
      slack_turn_was_resolved({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-send_message-1',
            tool_status: 'completed',
            input_data: { channel_id: turn_channel_id, message: 'Posted here.' },
          },
        ],
      }),
    ).toBe(true);
  });

  it('does not treat a send to a different channel as resolving this turn', () => {
    expect(
      slack_turn_was_resolved({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-send_message-1',
            tool_status: 'completed',
            input_data: { channel_id: 'C999', message: 'Posted elsewhere.' },
          },
        ],
      }),
    ).toBe(false);
  });

  it('treats an empty tool-call list as unresolved', () => {
    expect(slack_turn_was_resolved({ turn_channel_id, tool_calls: [] })).toBe(false);
  });

  it('treats an interim keep_working update as unresolved so the final reply is still required', () => {
    expect(
      slack_turn_was_resolved({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-respond-1',
            tool_status: 'completed',
            input_data: { resolution_type: 'reply', message: 'On it.', keep_working: true },
          },
        ],
      }),
    ).toBe(false);
  });
});

const output_message = (
  content_text: string | null,
  created_time: Date,
  overrides: Partial<SlackTurnRecoveryMessage> = {},
): SlackTurnRecoveryMessage => ({
  message_role: 'assistant',
  message_kind: 'output',
  is_user_visible: true,
  content_text,
  created_time,
  ...overrides,
});

describe('select_slack_turn_recovered_reply', () => {
  it('recovers the final user-visible assistant output', () => {
    expect(
      select_slack_turn_recovered_reply({
        turn_channel_id,
        tool_calls: [],
        run_messages: [
          output_message('Interim thought.', new Date('2026-07-12T21:56:30Z')),
          output_message('Here is the answer.', new Date('2026-07-12T21:56:40Z')),
        ],
      }),
    ).toEqual({ message: 'Here is the answer.', reply_source: 'assistant_output' });
  });

  it('never recovers reasoning or non-user-visible messages', () => {
    expect(
      select_slack_turn_recovered_reply({
        turn_channel_id,
        tool_calls: [],
        run_messages: [
          output_message('Private reasoning.', new Date('2026-07-12T21:56:30Z'), {
            message_kind: 'reasoning_summary',
          }),
          output_message('Hidden output.', new Date('2026-07-12T21:56:40Z'), {
            is_user_visible: false,
          }),
        ],
      }),
    ).toBeNull();
  });

  it('recovers the message of a reply-tool call whose send failed', () => {
    expect(
      select_slack_turn_recovered_reply({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-respond-1',
            tool_status: 'failed',
            input_data: { resolution_type: 'reply', message: 'The send that never landed.' },
            created_time: new Date('2026-07-12T21:56:40Z'),
          },
        ],
        run_messages: [],
      }),
    ).toEqual({ message: 'The send that never landed.', reply_source: 'reply_tool_input' });
  });

  it('prefers whichever safe artifact the model authored last', () => {
    const recovered = select_slack_turn_recovered_reply({
      turn_channel_id,
      tool_calls: [
        {
          tool_name: 'slack-respond-1',
          tool_status: 'failed',
          input_data: { resolution_type: 'reply', message: 'Earlier failed send.' },
          created_time: new Date('2026-07-12T21:56:30Z'),
        },
      ],
      run_messages: [output_message('Later final answer.', new Date('2026-07-12T21:56:45Z'))],
    });
    expect(recovered).toEqual({ message: 'Later final answer.', reply_source: 'assistant_output' });
  });

  it('returns null when nothing safe to publish exists', () => {
    expect(
      select_slack_turn_recovered_reply({ turn_channel_id, tool_calls: [], run_messages: [] }),
    ).toBeNull();
  });

  it('never recovers a failed keep_working interim update as the final reply', () => {
    expect(
      select_slack_turn_recovered_reply({
        turn_channel_id,
        tool_calls: [
          {
            tool_name: 'slack-respond-1',
            tool_status: 'failed',
            input_data: {
              resolution_type: 'reply',
              message: 'On it, give me a minute.',
              keep_working: true,
            },
            created_time: new Date('2026-07-12T21:56:40Z'),
          },
        ],
        run_messages: [],
      }),
    ).toBeNull();
  });

  it('never recovers a backfilled prior reply pulled in as thread history', () => {
    expect(
      select_slack_turn_recovered_reply({
        turn_channel_id,
        tool_calls: [],
        run_messages: [
          output_message('Answer from the previous turn.', new Date('2026-07-12T21:50:00Z'), {
            source_metadata: { slack: { history_backfill: true } },
          }),
        ],
      }),
    ).toBeNull();
  });

  it('never recovers an in-progress tool-use message as the final answer', () => {
    expect(
      select_slack_turn_recovered_reply({
        turn_channel_id,
        tool_calls: [],
        run_messages: [
          output_message('Let me verify that now.', new Date('2026-07-12T21:50:00Z'), {
            source_metadata: { provider_metadata: { stop_reason: 'toolUse' } },
          }),
        ],
      }),
    ).toBeNull();
  });
});
