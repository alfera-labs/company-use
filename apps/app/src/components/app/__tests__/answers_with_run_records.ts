import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatConversationWithRuns } from '@/components/app/chat_conversation_with_runs';
import type { ProjectedChatMessage } from '@/components/app/chat_stream_projection';
import type { Run } from '@/lib/api';

function finished_run(run_id: string, fields: Partial<Run>) {
  return {
    run_id,
    run_status: 'completed',
    model_name: 'claude-opus-4',
    input_tokens: 12_400,
    output_tokens: 1_100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_microcents: 0,
    usage_metadata: {},
    ...fields,
  } as Run;
}

export const runs_of_the_chat = [
  finished_run('run_plain_answer', {
    input_tokens: 850,
    output_tokens: 120,
    usage_metadata: { billing: { billing_treatment: 'byok', provider_cost_microcents: 400_000 } },
  }),
  finished_run('run_without_cost', { usage_metadata: { estimated: true } }),
  finished_run('run_with_steps', { cost_microcents: 27_000_000 }),
];

function answer(run_id: string, parts: ProjectedChatMessage['parts']): ProjectedChatMessage {
  return { id: `msg_${run_id}`, role: 'assistant', run_id, parts };
}

export const answer_with_steps = answer('run_with_steps', [
  {
    type: 'tool-workspace-write_file',
    input: { path: 'hello.md', content: 'Hello' },
    state: 'completed',
    toolCallId: 'tool_write',
    toolName: 'workspace-write_file',
  },
  { type: 'text', text: 'I saved the note as hello.md.' },
]);

export const answer_with_steps_and_no_cost = answer('run_without_cost', answer_with_steps.parts);

export const plain_answer = answer('run_plain_answer', [{ type: 'text', text: 'Hello.' }]);

/** The markup of a settled chat that holds the records of its runs. */
export function render_answers(messages: ProjectedChatMessage[], runs: readonly Run[]) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ChatConversationWithRuns, { isSubmitting: false, messages, runs }),
    ),
  );
}

/** The part of the markup that holds the folded steps of an answer and what follows them. */
export function markup_after(html: string, text: string) {
  const start = html.indexOf(text);
  if (start === -1) throw new Error(`The chat does not show "${text}"`);
  return html.slice(start);
}
