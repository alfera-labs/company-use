import type { ObservedRunTrace } from '@coworker/evals/observed_run_trace';
import {
  grade_observed_slack_trace,
  observed_slack_response_text,
} from '@coworker/evals/slack_observed_graders';
import { describe, expect, it } from 'vitest';

describe('observed Slack graders', () => {
  it('accepts a completed final slack-respond-1 call as a delivered response', () => {
    const trace = trace_fixture();
    const results = grade_observed_slack_trace(trace, [
      { grader_type: 'run_ended_clean' },
      { grader_type: 'assistant_response_present' },
      { grader_type: 'slack_turn_delivered' },
      { grader_type: 'minimum_tool_calls', count: 1 },
    ]);

    expect(results.every((result) => result.passed)).toBe(true);
    expect(observed_slack_response_text(trace)).toBe('Launch brief created.');
  });

  it('rejects a keep-working update as the final answer', () => {
    const trace = trace_fixture();
    const [tool_call] = trace.tool_calls;
    if (!tool_call) throw new Error('Expected a Slack response tool call fixture.');
    tool_call.input_data = {
      resolution_type: 'reply',
      keep_working: true,
      message: 'Still working.',
    };

    const [result] = grade_observed_slack_trace(trace, [
      { grader_type: 'assistant_response_present' },
    ]);

    expect(result?.passed).toBe(false);
  });
});

function trace_fixture(): ObservedRunTrace {
  const created_time = new Date();
  return {
    run: {
      run_id: 'run_test',
      workspace_id: 'ws_test',
      session_id: 'ses_test',
      run_status: 'completed',
      model_provider: 'anthropic',
      model_name: 'claude-sonnet-5',
      error_code: null,
      error_message: null,
      duration_ms: 100,
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 0,
      cost_microcents: 5,
      run_metadata: {},
      created_time,
    },
    messages: [
      {
        message_role: 'user',
        message_kind: 'input',
        content_text: 'Create a launch brief.',
        is_user_visible: true,
        source_type: 'slack',
        source_metadata: { slack: { channel_id: 'C123' } },
        created_time,
      },
    ],
    tool_calls: [
      {
        tool_name: 'slack-respond-1',
        tool_status: 'completed',
        risk_class: 'write_external',
        approval_mode: 'none',
        input_data: { resolution_type: 'reply', message: 'Launch brief created.' },
        output_text: 'ok',
        output_data: null,
        error_code: null,
        error_message: null,
        duration_ms: 20,
        created_time,
      },
    ],
    files: [],
  };
}
