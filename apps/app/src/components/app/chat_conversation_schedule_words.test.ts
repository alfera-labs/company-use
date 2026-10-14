import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatConversation } from '@/components/app/chat_conversation';
import type { ProjectedChatToolPart } from '@/components/app/chat_stream_projection';

describe('ChatConversation and the words for scheduled work', () => {
  it('renders a scheduled task as one centred event line, not as a bubble', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_system',
            role: 'user',
            authored_by_system: true,
            parts: [{ type: 'text', text: 'Check every rival pricing page.' }],
          },
        ],
      }),
    );

    expect(html).toContain('self-center');
    expect(html).toContain('Automation ran its instructions');
    expect(html).not.toContain('bg-bubble-mine');
    expect(html).not.toContain('Check every rival pricing page.');
  });

  it.each([
    ['scheduled_tasks-create_scheduled_task-1', scheduled_task_result(), 'Daily brief'],
    [
      'scheduled_tasks-list_scheduled_tasks-1',
      { count: 1, scheduled_tasks: [scheduled_task_result().scheduled_task] },
      'Daily brief',
    ],
    ['scheduled_tasks-edit_scheduled_task-1', scheduled_task_result(), 'Daily brief'],
    ['scheduled_tasks-set_scheduled_task_status-1', scheduled_task_result(), 'Daily brief'],
    [
      'scheduled_tasks-delete_scheduled_task-1',
      { scheduled_task_id: 'task_1', deleted: false },
      'The automation was not deleted.',
    ],
  ] as const)('renders the %s adapter through the conversation', (name, output, result) => {
    const html = render_tool({
      type: `tool-${name}`,
      toolCallId: `call_${name}`,
      toolName: name,
      state: 'completed',
      input: {},
      output,
    });

    expect(html).toContain('Automations');
    expect(html).toContain(result);
    expect(html).not.toContain('Result unavailable');
  });
});

function render_tool(part: ProjectedChatToolPart) {
  return renderToStaticMarkup(
    createElement(ChatConversation, {
      isSubmitting: false,
      messages: [{ id: 'msg_internal_tools', role: 'assistant', parts: [part] }],
      showFullTraces: true,
    }),
  );
}

function scheduled_task_result() {
  return {
    scheduled_task: {
      scheduled_task_id: 'task_1',
      name: 'Daily brief',
      status: 'disabled',
      cron_expression: '0 9 * * *',
      instruction: 'Send the daily brief.',
      context_digest: null,
      timezone: 'Europe/Rome',
      run_once_at: null,
      next_run_time: null,
      last_run_time: null,
    },
    dashboard_url: '/scheduled-tasks/task_1',
    activation: { status: 'waiting_for_card', say_to_user: 'Add a card.' },
  };
}
