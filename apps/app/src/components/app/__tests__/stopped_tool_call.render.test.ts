import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatConversation } from '@/components/app/chat_conversation';
import type {
  ProjectedChatMessage,
  ProjectedChatMessagePart,
} from '@/components/app/chat_stream_projection';
import { Tool } from '@/components/prompt-kit/tool';
import { tool_row_status } from '@/components/prompt-kit/tool_row_status';

const stopped_command: ProjectedChatMessagePart = {
  type: 'tool-workspace-run_command',
  input: { command: 'sleep', args: ['600'] },
  state: 'cancelled',
  errorText: 'Stopped before it finished.',
  toolCallId: 'tool_stopped',
  toolName: 'workspace-run_command',
};

const failed_command: ProjectedChatMessagePart = {
  type: 'tool-workspace-run_command',
  input: { command: 'false' },
  state: 'failed',
  errorText: 'Command exited with code 1.',
  toolCallId: 'tool_failed',
  toolName: 'workspace-run_command',
};

function render_answer(parts: ProjectedChatMessagePart[], active_run_id?: string) {
  const messages: ProjectedChatMessage[] = [
    { id: 'msg_user', role: 'user', parts: [{ type: 'text', text: 'Wait ten minutes.' }] },
    { id: 'msg_assistant', role: 'assistant', run_id: 'run_1', parts },
  ];
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ChatConversation, {
        isSubmitting: false,
        messages,
        ...(active_run_id ? { activeRunId: active_run_id } : {}),
      }),
    ),
  );
}

function render_row(state: string, error_text: string) {
  return renderToStaticMarkup(
    createElement(Tool, { state, errorText: error_text, toolName: 'workspace-run_command' }),
  );
}

describe('a command the person stopped', () => {
  it('says stopped in its row, in the plain colour, not failed and not an exit code', () => {
    const row = render_row('cancelled', 'Stopped before it finished.');

    expect(row).toContain('· stopped</span>');
    expect(row).not.toContain('failed');
    expect(row).not.toContain('text-destructive');
    expect(row).not.toContain('exited with code');
  });

  it('is stopped whatever its error text says, live and after a reload', () => {
    expect(tool_row_status('cancelled', 'Command exited with code 1.')).toBe('stopped');
    expect(tool_row_status('cancelled', undefined)).toBe('stopped');
    expect(tool_row_status('failed', 'Command exited with code 1.')).toBe('failed');
  });

  it('counts as stopped and not as failed in the fold of the settled answer', () => {
    const html = render_answer([stopped_command, { type: 'text', text: 'I stopped.' }]);

    expect(html).toContain('Worked · 1 step · 1 stopped');
    expect(html).toContain('· stopped</span>');
    expect(html).not.toContain('failed');
    expect(html).not.toContain('exited with code');
  });

  it('counts no failure while the run still winds down', () => {
    const html = render_answer([stopped_command], 'run_1');

    expect(html).not.toContain('failed');
  });

  it('leaves a command that failed on its own as failed', () => {
    const html = render_answer([failed_command, { type: 'text', text: 'It failed.' }]);

    expect(html).toContain('Worked · 1 step · 1 failed');
    expect(html).toContain('Command exited with code 1.');
    expect(render_row('failed', 'Command exited with code 1.')).toContain('text-destructive');
  });
});
