// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatConversationWithRuns } from '@/components/app/chat_conversation_with_runs';
import type {
  ProjectedChatMessage,
  ProjectedChatMessagePart,
} from '@/components/app/chat_stream_projection';
import type { Run } from '@/lib/api';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
}));

const user_message: ProjectedChatMessage = {
  id: 'msg_user',
  role: 'user',
  parts: [{ type: 'text', text: 'Which colour do I prefer?' }],
};

function answer(parts: ProjectedChatMessagePart[], sent_time?: string): ProjectedChatMessage {
  return {
    id: 'msg_assistant',
    role: 'assistant',
    run_id: 'run_1',
    parts,
    ...(sent_time ? { sent_time } : {}),
  };
}

function render_chat(input: {
  answer: ProjectedChatMessage;
  run_status: string;
  is_submitting?: boolean;
}) {
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ChatConversationWithRuns, {
        isSubmitting: input.is_submitting ?? false,
        messages: [user_message, input.answer],
        runs: [{ run_id: 'run_1', run_status: input.run_status } as Run],
        onChoiceAnswer: async () => true,
      }),
    ),
  );
  return page;
}

function question(overrides: Partial<ProjectedChatMessagePart>): ProjectedChatMessagePart {
  return {
    type: 'tool-chat-present_choices-1',
    toolName: 'chat-present_choices-1',
    toolCallId: 'tool_question',
    state: 'running',
    input: {
      questions: [
        {
          kind: 'choice',
          question: 'Which colour do you prefer?',
          options: [{ label: 'Red' }, { label: 'Blue' }],
          recommended_option: 'Red',
        },
      ],
    },
    ...overrides,
  } as ProjectedChatMessagePart;
}

function work_line(page: HTMLElement) {
  return [...page.querySelectorAll('[role="status"]')].map((line) => line.textContent);
}

describe('a question the coworker asks', () => {
  it('says it waits for the answer, and nothing says "Working" while it waits', () => {
    const page = render_chat({
      answer: answer([question({})]),
      run_status: 'waiting',
      is_submitting: true,
    });

    expect(page.textContent).toMatch(/Asked you to choose\s*· waiting for your answer/u);
    expect(work_line(page)).toEqual([]);
  });

  it('does not say "nobody answered" in the moment between the answer and its arrival', () => {
    const page = render_chat({
      answer: answer([question({ state: 'completed' })]),
      run_status: 'running',
      is_submitting: true,
    });

    expect(page.textContent).toContain('Asked you to choose');
    expect(page.textContent).not.toContain('nobody answered');
    expect(page.textContent).not.toContain('waiting for your answer');
    expect(work_line(page)).toEqual(['Working']);
  });

  it('shows the answer once it arrives', () => {
    const page = render_chat({
      answer: answer([question({ state: 'completed', output: { answered: true, answer: 'Red' } })]),
      run_status: 'running',
      is_submitting: true,
    });

    expect(page.textContent).toContain('Red');
    expect(page.textContent).not.toContain('nobody answered');
  });

  it('shows the answer from the live stream, which holds it as text inside content blocks', () => {
    const result_as_the_engine_hands_it = {
      content: [{ type: 'text', text: JSON.stringify({ answered: true, answer: 'Red' }) }],
    };
    const steps_after_the_click = [
      question({ state: 'completed' }),
      question({ state: 'completed', output: result_as_the_engine_hands_it }),
      question({ state: 'completed', output: { answered: true, answer: 'Red' } }),
    ].map((asked) =>
      render_chat({ answer: answer([asked]), run_status: 'running', is_submitting: true }),
    );

    for (const page of steps_after_the_click) {
      expect(page.textContent).not.toContain('nobody answered');
    }
    expect(steps_after_the_click.map((page) => page.textContent?.includes('Red'))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it.each([
    ['was withdrawn', question({ state: 'cancelled' })],
    [
      'closed with no answer, read from the live stream',
      question({
        state: 'completed',
        output: { content: [{ type: 'text', text: JSON.stringify({ answered: false }) }] },
      }),
    ],
    ['closed with no answer', question({ state: 'completed', output: { answered: false } })],
  ])('says nobody answered a question that %s', (_name, closed_question) => {
    const page = render_chat({ answer: answer([closed_question]), run_status: 'cancelled' });

    expect(page.textContent).toMatch(/Asked you to choose\s*· nobody answered/u);
  });
});

describe('an answer the person stopped', () => {
  const half_an_answer = answer([{ type: 'text', text: 'The eight planets are' }]);
  const stopped_words = 'Stopped. Send a message to go on.';

  it('is marked as stopped in the chat, under the answer', () => {
    const page = render_chat({ answer: half_an_answer, run_status: 'cancelled' });

    expect(page.textContent).toContain(stopped_words);
    expect(page.textContent?.indexOf(stopped_words)).toBeGreaterThan(
      page.textContent?.indexOf('The eight planets are') ?? -1,
    );
  });

  it.each(['completed', 'running', 'failed'])('has no stopped mark when the run %s', (status) => {
    const page = render_chat({ answer: half_an_answer, run_status: status });

    expect(page.textContent).not.toContain(stopped_words);
  });
});

describe('the time of an answer', () => {
  const text: ProjectedChatMessagePart[] = [{ type: 'text', text: 'Eight planets.' }];

  it('sits beside the name and takes no width from the bubble when the answer is saved', () => {
    const live = render_chat({ answer: answer(text), run_status: 'completed' });
    const saved = render_chat({
      answer: answer(text, '2026-10-12T19:22:00.000Z'),
      run_status: 'completed',
    });
    const bubble_row = (page: HTMLElement) =>
      [...page.querySelectorAll('div')].find(
        (element) => element.className === 'flex min-w-full items-center gap-3',
      );

    expect(live.querySelector('time')).toBeNull();
    expect(saved.querySelector('time')?.parentElement?.textContent).toContain('Alfera');
    expect(bubble_row(saved)?.children).toHaveLength(1);
    expect(bubble_row(saved)?.children.length).toBe(bubble_row(live)?.children.length);
  });
});
