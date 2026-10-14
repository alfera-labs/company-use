// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatConversationWithRuns } from '@/components/app/chat_conversation_with_runs';
import { chat_assistant_bubble_class_name } from '@/components/app/chat_message';
import type {
  ProjectedChatMessage,
  ProjectedChatMessagePart,
} from '@/components/app/chat_stream_projection';
import type { Run } from '@/lib/api';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
}));

const note = 'Font path fix: I will point the tool at another font.';
const answer = 'Here is your chart.';

const question: ProjectedChatMessage = {
  id: 'msg_user',
  role: 'user',
  parts: [{ type: 'text', text: 'Make a bar chart.' }],
};

function text(words: string): ProjectedChatMessagePart {
  return { type: 'text', text: words };
}

function command(tool_call_id: string, state: string): ProjectedChatMessagePart {
  return {
    type: 'tool-computer-bash-1',
    toolName: 'computer-bash-1',
    toolCallId: tool_call_id,
    state,
    input: { command: 'convert chart.svg chart.png' },
  } as ProjectedChatMessagePart;
}

function render_chat(parts: ProjectedChatMessagePart[], run_status: string) {
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ChatConversationWithRuns, {
        isSubmitting: run_status === 'running',
        messages: [question, { id: 'msg_assistant', role: 'assistant', run_id: 'run_1', parts }],
        runs: [{ run_id: 'run_1', run_status } as Run],
      }),
    ),
  );
  return page;
}

function answer_bubbles(page: HTMLElement) {
  return [...page.querySelectorAll('div')]
    .filter((element) => element.className.includes(chat_assistant_bubble_class_name))
    .map((element) => element.textContent);
}

function steps_of_the_work(page: HTMLElement) {
  return [...page.querySelectorAll('[inert]')].map((element) => element.textContent).join(' ');
}

describe('a note the coworker writes between two steps of its work', () => {
  it('is an answer bubble while it is the last thing said, then goes to the steps of the work', () => {
    const first_step = command('tool_1', 'completed');
    const note_is_the_last_text = render_chat([first_step, text(note)], 'running');
    expect(answer_bubbles(note_is_the_last_text)).toEqual([note]);

    const work_goes_on = [first_step, text(note), command('tool_2', 'running')];
    expect(answer_bubbles(render_chat(work_goes_on, 'running'))).toEqual([note]);

    const whole_run = [first_step, text(note), command('tool_2', 'completed'), text(answer)];
    const answer_is_written = render_chat(whole_run, 'running');
    expect(answer_bubbles(answer_is_written)).toEqual([answer]);
    expect(steps_of_the_work(answer_is_written)).toContain(note);

    const after_a_reload = render_chat(whole_run, 'completed');
    expect(answer_bubbles(after_a_reload)).toEqual([answer]);
    expect(steps_of_the_work(after_a_reload)).toContain(note);
  });

  it('never takes an answer away: the last text of a run stays a bubble', () => {
    const answer_then_one_more_step = [text(answer), command('tool_1', 'completed')];
    expect(answer_bubbles(render_chat(answer_then_one_more_step, 'completed'))).toEqual([answer]);

    const answer_in_two_parts = [command('tool_1', 'completed'), text(note), text(answer)];
    expect(answer_bubbles(render_chat(answer_in_two_parts, 'completed'))).toEqual([note, answer]);
  });
});
