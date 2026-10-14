import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatConversation } from '@/components/app/chat_conversation';
import {
  chat_thread_tool_calls,
  create_projected_chat_messages,
  type ProjectedChatMessage,
  type ProjectedChatMessagePart,
} from '@/components/app/chat_stream_projection';
import { is_failed_tool_call } from '@/components/app/tool_call_outcome';

const written_file: ProjectedChatMessagePart = {
  type: 'tool-workspace-write_file',
  input: { path: '/workspace/files/tip-calculator.html' },
  state: 'completed',
  toolCallId: 'tool_write',
  toolName: 'workspace-write_file',
};

function command(overrides: Partial<ProjectedChatMessagePart>): ProjectedChatMessagePart {
  return {
    type: 'tool-workspace-run_command',
    input: { command: "grep -cE 'https?://' tip-calculator.html" },
    state: 'failed',
    toolCallId: 'tool_command',
    toolName: 'workspace-run_command',
    ...overrides,
  } as ProjectedChatMessagePart;
}

const counted_nothing = command({
  errorCode: 'command_failed',
  errorText: '0\n\nCommand exited with code 1.',
});
const timed_out = command({ errorCode: 'timed_out', errorText: 'Command timed out.' });
const blocked = command({ errorCode: 'blocked_by_policy', errorText: 'This path is read-only.' });

function render_answer(parts: ProjectedChatMessagePart[], show_full_traces = false) {
  const messages: ProjectedChatMessage[] = [
    { id: 'msg_user', role: 'user', parts: [{ type: 'text', text: 'A tip calculator.' }] },
    {
      id: 'msg_assistant',
      role: 'assistant',
      run_id: 'run_1',
      parts: [...parts, { type: 'text', text: 'Your tip calculator is ready.' }],
    },
  ];
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ChatConversation, {
        isSubmitting: false,
        messages,
        showFullTraces: show_full_traces,
      }),
    ),
  );
}

describe('a command that ended with an exit code other than 0', () => {
  it('is not counted as failed in the fold of the answer', () => {
    const html = render_answer([written_file, counted_nothing]);

    expect(html).toContain('Worked · 2 steps');
    expect(html).not.toContain('failed');
  });

  it('names the exit code in its row, in the plain colour, and says it ran', () => {
    const html = render_answer([written_file, counted_nothing], true);

    expect(html).toContain('· exit code not 0</span>');
    expect(html).toContain('Ran <span');
    expect(html).not.toContain('Tried to run');
    expect(html).not.toContain('text-destructive');
    expect(html).toContain('Command exited with code 1.');
  });

  it.each([
    ['a command that timed out', timed_out],
    ['a command the workspace refused', blocked],
    ['a failed step of an older answer, stored without its code', command({ errorText: 'boom' })],
  ])('still shows %s as failed, in red', (_name, failed_command) => {
    expect(is_failed_tool_call(failed_command as { state: string })).toBe(true);
    expect(render_answer([written_file, failed_command])).toContain('Worked · 2 steps · 1 failed');
    expect(render_answer([written_file, failed_command], true)).toContain('text-destructive');
  });

  it('reads the code of the step from the saved step and from the live stream', () => {
    const saved_step = {
      tool_call_id: 'tcall_1',
      run_id: 'run_1',
      tool_name: 'workspace-run_command',
      tool_status: 'failed',
      input_data: {},
      error_code: 'command_failed',
      error_message: 'Command exited with code 1.',
    };
    const [message] = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      tool_calls: [saved_step],
    });
    const [live_step] = chat_thread_tool_calls({
      event_ids: {},
      items: [
        {
          item_id: 'item_1',
          item_type: 'tool_call',
          item_status: 'failed',
          item_sequence: 1,
          run_id: 'run_1',
          tool_name: 'workspace-run_command',
          error: { code: 'command_failed', message: 'Command exited with code 1.' },
        },
      ],
    });

    expect(message?.parts[0]).toMatchObject({ errorCode: 'command_failed' });
    expect(live_step).toMatchObject({ error_code: 'command_failed' });
  });
});
