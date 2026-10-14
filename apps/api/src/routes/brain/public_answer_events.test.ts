import {
  project_public_answer_events,
  public_answer_error,
} from '@api/routes/brain/public_answer_events';
import type { ChatItemDelta } from '@runtime-platform/chat_stream/chat_stream_events';
import type { AgentRunStreamEvent } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { describe, expect, it } from 'vitest';

const conversation_id = 'support-ticket-9931';

function item_delta_event(delta: ChatItemDelta): AgentRunStreamEvent {
  return {
    type: 'chat_event',
    event: {
      event_id: 'evt_test',
      workspace_id: 'ws_test',
      session_id: 'ses_test',
      run_id: 'run_test',
      sequence: 1,
      event_type: 'item_delta',
      occurred_time: '2026-08-05T00:00:00.000Z',
      source: { source_type: 'runtime_event' },
      item_id: 'item_test',
      delta,
    },
  };
}

const deltas_a_customer_must_never_see: Exclude<ChatItemDelta, { delta_type: 'text_delta' }>[] = [
  { delta_type: 'thinking_delta', text: 'The margin on this package is 41%, so I can discount.' },
  { delta_type: 'markdown_delta', markdown: '## Internal notes' },
  { delta_type: 'tool_input_delta', input_delta: { query: 'margins' } },
  { delta_type: 'tool_output_delta', output_delta: { rows: 3 }, output_text_delta: 'margin: 41%' },
  { delta_type: 'artifact_content_delta', file_id: 'art_test', content_delta: 'draft' },
  { delta_type: 'generative_ui_delta', ui_spec_delta: { kind: 'table' } },
];

describe('project_public_answer_events', () => {
  it.each(deltas_a_customer_must_never_see)('drops a $delta_type', (delta) => {
    expect(project_public_answer_events(item_delta_event(delta), conversation_id)).toEqual([]);
  });

  it('forwards only the assistant spoken text', () => {
    const event = item_delta_event({ delta_type: 'text_delta', text: 'She can move it' });

    expect(project_public_answer_events(event, conversation_id)).toEqual([
      { event: 'answer.delta', data: { text: 'She can move it' } },
    ]);
  });
});

const generic_message = "The run couldn't be completed. Please try again.";

describe('public_answer_error', () => {
  it('lets an actionable failure keep its code and its own message', () => {
    expect(
      public_answer_error({ code: 'out_of_credits', message: 'This workspace is out of credits.' }),
    ).toEqual({ code: 'out_of_credits', message: 'This workspace is out of credits.' });
  });

  const failures_a_customer_must_never_read = [
    { code: '23505', message: 'duplicate key value violates unique constraint "runs_pkey"' },
    { code: 'event_job_handler_failed', message: 'openai 500: billing account xyz suspended' },
    { code: 'not_found', message: 'Session was not found' },
    { code: null, message: null },
    null,
  ];

  it.each(failures_a_customer_must_never_read)('reports %o as run_failed', (failure) => {
    expect(public_answer_error(failure)).toEqual({ code: 'run_failed', message: generic_message });
  });
});
