import type { PresentChoicesQuestion } from '@coworker/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { combined_choice_reply, record_choice_answer } from '@/components/app/chat_choice_dock';
import { latest_connection_requests } from '@/components/app/chat_connection_dock';
import { assistant_text_for_display } from '@/components/app/chat_connection_setup_text';
import { assistant_part_run_key, ChatConversation } from '@/components/app/chat_conversation';
import {
  chat_assistant_bubble_class_name,
  chat_markdown_class_name,
  chat_work_pill_class_name,
} from '@/components/app/chat_message';
import { day_separator_label } from '@/components/app/chat_message_times';
import type {
  ProjectedChatMessage,
  ProjectedChatToolPart,
} from '@/components/app/chat_stream_projection';
import type { CatalogApp } from '@/lib/api';

// The router's Link needs a live RouterProvider above it, which nothing here mounts. The
// stand-in fills the path params and renders the same anchor the assertions read.
vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
}));

describe('ChatConversation', () => {
  it('keeps scrolling on the sticky chat viewport', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            parts: [{ type: 'text', text: 'The final agent response.' }],
          },
        ],
      }),
    );

    expect(html).toContain(
      'relative flex h-full min-h-0 w-full flex-1 flex-col items-center overflow-hidden',
    );
    expect(html).toContain('flex overflow-y-auto relative h-full min-h-0 w-full flex-1');
    expect(html).toContain('The final agent response.');
  });

  it('gives chronological blocks breathing room and renders the first paint already settled', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            parts: [
              { type: 'reasoning', text: 'Check the records.', state: 'complete' },
              { type: 'text', text: 'The final agent response.' },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('flex min-w-full flex-col gap-2');
    expect(html).toContain(chat_assistant_bubble_class_name);
    expect(html).not.toContain(chat_work_pill_class_name);
    expect(html).not.toContain('opacity:0;transform');
    expect(html.match(/opacity:1;transform:none/gu)).toHaveLength(2);
  });

  it('names who is speaking once per turn, above the first bubble', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        assistantName: 'Alfera',
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'First paragraph.' },
              { type: 'text', text: 'Second paragraph.' },
            ],
          },
        ],
      }),
    );

    const attribution = 'mb-1.5 flex items-center gap-2 pl-0.5';
    expect(count_occurrences(html, attribution)).toBe(1);
    expect(html.indexOf('Alfera')).toBeLessThan(html.indexOf(chat_assistant_bubble_class_name));
  });

  it('names the voice once per run of assistant turns, not once per turn', () => {
    const assistant_turn = (id: string): ProjectedChatMessage => ({
      id,
      role: 'assistant',
      parts: [{ type: 'text', text: `Answer from ${id}.` }],
    });
    const attribution = 'mb-1.5 flex items-center gap-2 pl-0.5';

    const back_to_back = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [assistant_turn('msg_a'), assistant_turn('msg_b')],
      }),
    );
    const split_by_a_reply = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          assistant_turn('msg_a'),
          { id: 'msg_user', role: 'user', parts: [{ type: 'text', text: 'Go on.' }] },
          assistant_turn('msg_b'),
        ],
      }),
    );

    expect(count_occurrences(back_to_back, attribution)).toBe(1);
    expect(count_occurrences(split_by_a_reply, attribution)).toBe(2);
  });

  it("puts the reader's own words in their own bubble colour", () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [{ id: 'msg_user', role: 'user', parts: [{ type: 'text', text: 'Do it.' }] }],
      }),
    );

    expect(html).toContain('bg-bubble-mine');
    expect(html).not.toContain(chat_assistant_bubble_class_name);
  });

  it('keeps a message time beside its bubble, hidden until the row is pointed at', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_user',
            role: 'user',
            parts: [{ type: 'text', text: 'Do it.' }],
            sent_time: '2026-06-16T09:00:00.000Z',
          },
        ],
      }),
    );

    expect(html).toContain('dateTime="2026-06-16T09:00:00.000Z"');
    expect(html).toContain('group-hover/message:opacity-100');
    expect(html.indexOf('dateTime=')).toBeLessThan(html.indexOf('bg-bubble-mine'));
    expect(html).not.toContain('font-medium text-foreground');
  });

  it('always names the sender above a user message', () => {
    const first_speaker: ProjectedChatMessage = {
      id: 'msg_one',
      role: 'user',
      parts: [{ type: 'text', text: 'First question.' }],
      sender: { source_actor_id: 'platform:user_1', display_name: 'Otto Park' },
      sent_time: '2026-06-16T09:00:00.000Z',
    };
    const second_speaker: ProjectedChatMessage = {
      id: 'msg_two',
      role: 'user',
      parts: [{ type: 'text', text: 'Second question.' }],
      sender: { source_actor_id: 'slack:T1:U9', display_name: 'Robin Tate' },
      sent_time: '2026-06-16T09:30:00.000Z',
    };

    const alone = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages: [first_speaker] }),
    );
    const together = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [first_speaker, second_speaker],
      }),
    );

    expect(alone).toContain('Otto Park');
    expect(together).toContain('Otto Park');
    expect(together).toContain('Robin Tate');
  });

  it('marks each new day once, and only between days', () => {
    const message_at = (id: string, sent_time: string): ProjectedChatMessage => ({
      id,
      role: 'user',
      parts: [{ type: 'text', text: `Message ${id}.` }],
      sent_time,
    });
    const first_day = day_separator_label(local_time_of(2026, 6, 16, 9), Date.now());
    const second_day = day_separator_label(local_time_of(2026, 6, 17, 9), Date.now());

    const one_day = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          message_at('a', local_time_of(2026, 6, 16, 9)),
          message_at('b', local_time_of(2026, 6, 16, 22)),
        ],
      }),
    );
    const two_days = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          message_at('a', local_time_of(2026, 6, 16, 9)),
          message_at('b', local_time_of(2026, 6, 17, 9)),
        ],
      }),
    );

    expect(count_occurrences(one_day, first_day)).toBe(1);
    expect(count_occurrences(one_day, second_day)).toBe(0);
    expect(count_occurrences(two_days, first_day)).toBe(1);
    expect(count_occurrences(two_days, second_day)).toBe(1);
  });

  it("accents the live row's subject and leaves a settled one grey", () => {
    const running_html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: [running_command_message('running')],
      }),
    );
    const done_html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [running_command_message('completed')],
      }),
    );

    expect(tool_rows(running_html).by_title('pnpm build')).toContain(
      '<span class="font-mono text-[13px] text-brand-ink">pnpm build</span>',
    );
    expect(tool_rows(done_html).by_title('pnpm build')).toContain(
      '<span class="font-mono text-[13px]">pnpm build</span>',
    );
  });

  it('keeps final text in bubbles and puts all work behind one plain disclosure', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            run_id: 'run_1',
            parts: [
              { type: 'reasoning', text: 'Weighing the options.', state: 'complete' },
              workspace_tool_part('workspace-read_file-1', { path: 'ledger.csv' }),
              workspace_tool_part('workspace-read_file-1', { path: 'rivals.csv' }),
              { type: 'text', text: 'First paragraph.' },
              { type: 'text', text: 'Second paragraph.' },
            ],
          },
        ],
      }),
    );

    expect(count_occurrences(html, chat_assistant_bubble_class_name)).toBe(2);
    expect(count_occurrences(html, 'Worked so far')).toBe(1);
    expect(html).not.toContain(chat_work_pill_class_name);
  });

  it('does not restart the text reveal animation for each streamed token', () => {
    const first_key = assistant_part_run_key({
      part: { type: 'text', text: 'Streaming' },
      startIndex: 0,
      type: 'part',
    });
    const next_key = assistant_part_run_key({
      part: { type: 'text', text: 'Streaming one more token' },
      startIndex: 0,
      type: 'part',
    });

    expect(next_key).toBe(first_key);
  });

  it('keeps assistant chat markdown out of article-style prose spacing', () => {
    expect(chat_markdown_class_name.split(/\s+/u)).not.toContain('prose');
    expect(chat_markdown_class_name.split(/\s+/u)).not.toContain('dark:prose-invert');
  });

  it('renders Slack employee names and times above their messages', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_otto',
        role: 'user',
        parts: [{ type: 'text', text: 'First question.' }],
        sender: { source_actor_id: 'slack:T123:U123', display_name: 'Otto Park' },
        sent_time: '2026-06-16T09:00:00.000Z',
      },
      {
        id: 'msg_robin',
        role: 'user',
        parts: [{ type: 'text', text: 'Second question.' }],
        sender: { source_actor_id: 'slack:T123:U456', display_name: 'Robin Tate' },
        sent_time: '2026-06-16T09:30:00.000Z',
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages }),
    );

    expect(html).toContain('Otto Park');
    expect(html).toContain('Robin Tate');
    expect(html).toContain('dateTime="2026-06-16T09:00:00.000Z"');
    expect(html.indexOf('Otto Park')).toBeLessThan(html.indexOf('First question.'));
    expect(html.indexOf('Robin Tate')).toBeLessThan(html.indexOf('Second question.'));
  });

  it('renders text, reasoning, running, completed, and failed tool parts', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_user',
        role: 'user',
        parts: [{ type: 'text', text: 'Check Gmail.' }],
      },
      {
        id: 'msg_assistant',
        role: 'assistant',
        run_id: 'run_1',
        parts: [
          { type: 'reasoning', text: 'Plan the query.', state: 'streaming' },
          { type: 'text', text: 'I will check.' },
          {
            type: 'tool-gmail-find_email-1',
            display: { title: 'Find email', subtitle: 'Gmail' },
            input: { q: 'is:unread' },
            state: 'running',
            toolCallId: 'tool_running',
            toolName: 'gmail-find_email-1',
          },
          {
            type: 'tool-gmail-read_email-1',
            display: { title: 'Read email', subtitle: 'Gmail' },
            output: 'message body',
            state: 'completed',
            toolCallId: 'tool_done',
            toolName: 'gmail-read_email-1',
          },
          {
            type: 'tool-gmail-send_email-1',
            display: { title: 'Send email', subtitle: 'Gmail' },
            errorText: 'Permission denied.',
            state: 'failed',
            toolCallId: 'tool_failed',
            toolName: 'gmail-send_email-1',
          },
          { type: 'artifact', artifactId: 'artifact_1', kind: 'text', title: 'Draft reply' },
        ],
      },
    ];

    const html = render_conversation({
      activeRunId: 'run_1',
      isSubmitting: false,
      messages,
      onArtifactOpen: vi.fn(),
    });

    expect(html).toContain('Check Gmail.');
    expect(html).toContain('Plan the query.');
    expect(html).toContain('Worked so far · 1 failed');
    expect(html).not.toContain('animate-spin');
    expect(html).toContain('1 failed');
    expect(html).toContain('Finding email');
    expect(html).toContain('Read email');
    expect(html).toContain('Tried to send email');
    expect(html).toContain('failed');
    expect(html).toContain('Draft reply');

    const rows = tool_rows(html);
    const read_email_row = rows.by_title('Read email');
    expect(rows.by_title('Finding email')).toContain('chat-activity-breathe');
    expect(rows.by_title('Tried to send email')).toContain('text-destructive');
    expect(rows.by_title('Tried to send email')).toContain('Permission denied.');
    expect(read_email_row).not.toContain('chat-activity-breathe');
    expect(read_email_row).not.toContain('text-destructive');
    expect(read_email_row).not.toMatch(/>\s*done\b/u);
    expect(read_email_row).not.toMatch(/\d+(\.\d+)?\s*(ms|s)\b/u);
    expect(read_email_row).not.toMatch(/rounded-xl|ring-1|bg-muted\b|border-border/u);
  });

  it('opens assistant http links outside the chat tab', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Open [the report](https://example.com/report).' }],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages,
      }),
    );

    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('renders catalog app icons for action rows when a tool resolves to an app', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-gmail-find_email-1',
            display: { appId: 'app_gmail', title: 'Find email', subtitle: 'Gmail' },
            input: { q: 'is:unread' },
            state: 'running',
            toolCallId: 'tool_running',
            toolName: 'gmail-find_email-1',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        apps: [
          catalog_app({
            app_display_name: 'Gmail',
            app_name: 'gmail',
            icon_url: 'https://example.com/gmail.png',
          }),
        ],
        isSubmitting: false,
        messages,
      }),
    );

    expect(html).toContain('Tried to find email');
    expect(html).toContain('https://example.com/gmail.png');

    const brand_mark = html
      .split('background-image:url(&quot;https://example.com/gmail.png&quot;)')
      .at(0)
      ?.split('<span')
      .at(-1);
    expect(brand_mark).toContain('size-[15px]');
    expect(brand_mark).not.toMatch(/rounded|border|ring-1|bg-background/u);
  });

  it('shows expandable details for internal tool panels', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            parts: [
              {
                type: 'tool-workspace-read_file-1',
                display: { title: 'Read file' },
                input: { path: '/repo/package.json' },
                state: 'completed',
                toolCallId: 'tool_with_detail',
                toolName: 'workspace-read_file-1',
              },
              {
                type: 'tool-workspace-preview-1',
                display: { title: 'Start preview' },
                state: 'completed',
                toolCallId: 'tool_without_detail',
                toolName: 'workspace-preview-1',
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Files');
    expect(html).toContain('Browser');
    expect(count_occurrences(html, 'aria-expanded="false"')).toBeGreaterThanOrEqual(2);
    expect(html).toContain('aria-expanded="false"');
  });

  it('groups file tools while keeping command and connected-app rows', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            parts: [
              {
                type: 'tool-workspace-write_file-1',
                input: { path: '/repo/src/style.css' },
                state: 'completed',
                toolCallId: 'tool_write',
                toolName: 'workspace-write_file-1',
              },
              {
                type: 'tool-workspace-read_file-1',
                input: { path: '/repo/package.json' },
                state: 'completed',
                toolCallId: 'tool_read',
                toolName: 'workspace-read_file-1',
              },
              {
                type: 'tool-workspace-run_command-1',
                state: 'completed',
                toolCallId: 'tool_command',
                toolName: 'workspace-run_command-1',
              },
              {
                type: 'tool-workspace-run_command-1',
                input: { command: 'pnpm test\n--watch' },
                state: 'completed',
                toolCallId: 'tool_command_text',
                toolName: 'workspace-run_command-1',
              },
              {
                type: 'tool-gmail-read_email-1',
                display: { title: 'Read email', subtitle: 'Gmail' },
                state: 'completed',
                toolCallId: 'tool_gmail_read',
                toolName: 'gmail-read_email-1',
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Files');
    expect(html).toContain('2 actions · 2 issues');
    expect(html).toContain('Ran a command');
    expect(html).toContain('pnpm test');
    expect(html).not.toContain('--watch');
    expect(html).toContain('Read email');
  });

  it('renders the assistant working indicator while streaming', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: true,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Already streamed output.' }],
          },
        ],
      }),
    );

    expect(html).toContain('Already streamed output.');
    expect(html).toContain('role="status"');
    expect(html).toContain('Working');
    expect(html).not.toContain('Worked so far');
    expect(count_occurrences(html, 'chat-working-dot size-[7px]')).toBe(3);
    expect(html).toContain('animation-delay:0.15s');
    expect(html).not.toContain('rounded-full border');
  });

  it('keeps tool work outside thoughts at its chronological position', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_progress',
        role: 'assistant',
        run_id: 'run_1',
        parts: [
          {
            type: 'tool-runtime-execute_tool-1',
            display: { title: 'Search Pages', subtitle: 'Notion' },
            state: 'completed',
            toolCallId: 'tool_search',
            toolName: 'runtime-execute_tool-1',
          },
          {
            durationMs: 65_000,
            type: 'reasoning',
            text: 'Refining the Gmail query.',
            state: 'complete',
          },
          { type: 'text', text: 'I found the relevant account.' },
        ],
      },
      {
        id: 'msg_final',
        role: 'assistant',
        run_id: 'run_1',
        parts: [
          {
            type: 'tool-runtime-execute_tool-1',
            display: { title: 'Find Email', subtitle: 'Gmail' },
            state: 'completed',
            toolCallId: 'tool_find',
            toolName: 'runtime-execute_tool-1',
          },
          {
            type: 'reasoning',
            text: 'Checking the final answer.',
            state: 'complete',
          },
          { type: 'text', text: 'Done. Here is the answer.' },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages,
      }),
    );
    const progress_index = html.indexOf('I found the relevant account.');
    const first_reasoning_index = html.indexOf('Refining the Gmail query.');
    const second_reasoning_index = html.indexOf('Checking the final answer.');
    const final_index = html.indexOf('Done. Here is the answer.');

    expect(html).toContain('Worked so far');
    expect(first_reasoning_index).toBeLessThan(progress_index);
    expect(second_reasoning_index).toBeLessThan(final_index);
    expect(html).not.toContain('group/internal');
  });

  it('folds completed tool-family work behind its summary', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        run_id: 'run_1',
        parts: [
          { type: 'reasoning', text: 'First thought.', state: 'complete' },
          {
            type: 'tool-runtime-search_tools-12',
            state: 'completed',
            toolCallId: 'tool_hidden',
            toolName: 'runtime-search_tools-12',
          },
          { type: 'reasoning', text: 'Second thought.', state: 'complete' },
          {
            type: 'tool-runtime-execute_tool-1',
            display: { title: 'First action', subtitle: 'Attio' },
            state: 'completed',
            toolCallId: 'tool_completed',
            toolName: 'runtime-execute_tool-1',
          },
          {
            type: 'tool-runtime-execute_tool-1',
            display: { title: 'Second action', subtitle: 'Attio' },
            state: 'running',
            toolCallId: 'tool_running',
            toolName: 'runtime-execute_tool-1',
          },
          {
            type: 'tool-runtime-get_tool_schema-3',
            state: 'completed',
            toolCallId: 'tool_hidden_inside_group',
            toolName: 'runtime-get_tool_schema-3',
          },
          {
            type: 'tool-runtime-execute_tool-1',
            display: { title: 'Third action', subtitle: 'Attio' },
            errorText: 'Invalid record.',
            state: 'failed',
            toolCallId: 'tool_failed',
            toolName: 'runtime-execute_tool-1',
          },
          { type: 'reasoning', text: 'Third thought.', state: 'streaming' },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { activeRunId: 'run_1', isSubmitting: false, messages }),
    );
    expect(html).toContain('First thought.');
    expect(html).toContain('Second thought.');
    expect(html).toContain('Third thought.');
    expect(html).toContain('First action');
    expect(html).toContain('Second action');
    expect(html).toContain('Third action');
    expect(html).not.toContain('group/internal');
    expect(html).toContain('1 failed');
    expect(html.indexOf('First thought.')).toBeLessThan(html.indexOf('Second thought.'));
    expect(html).toContain('Worked so far · 1 failed');
    expect(html.indexOf('Worked so far · 1 failed')).toBeLessThan(html.indexOf('First thought.'));
    expect(html.indexOf('Third action')).toBeLessThan(html.indexOf('Third thought.'));
  });

  it('shows a short collapsed preview beside the thought duration', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          {
            durationMs: 12_000,
            type: 'reasoning',
            text: 'Checking the account records before creating the final verified list for the user.',
            state: 'complete',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages }),
    );

    expect(html).toContain('Worked · thought for 12s');
    expect(html).toContain('Checking the account records before creating the final verified list');
    expect(html).toContain('aria-expanded="false"');
  });

  it('labels completed tool groups with action summaries', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'I will inspect this.' },
          {
            type: 'tool-runtime-search_tools-12',
            state: 'completed',
            toolCallId: 'tool_catalog_search',
            toolName: 'runtime-search_tools-12',
          },
          {
            type: 'tool-runtime-web_search-1',
            display: { title: 'Search Web', subtitle: 'Alfera runtime' },
            state: 'completed',
            toolCallId: 'tool_web_search',
            toolName: 'runtime-web_search-1',
          },
          {
            type: 'tool-runtime-read_url-1',
            display: { title: 'Read URL', subtitle: 'Alfera runtime' },
            state: 'completed',
            toolCallId: 'tool_read_url',
            toolName: 'runtime-read_url-1',
          },
          {
            type: 'tool-workspace-search',
            state: 'completed',
            toolCallId: 'tool_search',
            toolName: 'workspace-search',
          },
          {
            type: 'tool-workspace-exec_command',
            state: 'completed',
            toolCallId: 'tool_run_1',
            toolName: 'workspace-exec_command',
          },
          {
            type: 'tool-workspace-exec_command',
            state: 'completed',
            toolCallId: 'tool_run_2',
            toolName: 'workspace-exec_command',
          },
          {
            type: 'tool-slack-list_workspace_members-1',
            state: 'completed',
            toolCallId: 'tool_members',
            toolName: 'slack-list_workspace_members-1',
          },
          {
            type: 'tool-runtime-execute_tool-1',
            display: { title: 'Create Page', subtitle: 'Notion' },
            state: 'failed',
            toolCallId: 'tool_create_page',
            toolName: 'runtime-execute_tool-1',
          },
          {
            type: 'tool-slack-send_message-1',
            state: 'completed',
            toolCallId: 'tool_send_message',
            toolName: 'slack-send_message-1',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages,
      }),
    );

    expect(html).toContain('I will inspect this.');
    expect(html).toContain('>Searched<');
    expect(html).not.toContain('Searched, read a file, completed 2 actions');
    expect(html).not.toContain('Searched code');
    expect(html).toContain('Listed a directory');
    expect(html).toContain('Search results unavailable');
    expect(html).toContain('Pages');
    expect(html).toContain('Tools');
    expect(html).toContain('Tried to create Page');
    expect(html).toContain('Notion');
    expect(html).toContain('Sent a message');
    expect(html).toContain('1 failed');
  });

  it('shows completed web search details when the worked fold is open', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_search',
        role: 'assistant',
        parts: [
          {
            type: 'tool-runtime-web_search-1',
            state: 'completed',
            toolCallId: 'search_1',
            toolName: 'runtime-web_search-1',
            input: { query: 'current agent search interfaces' },
            output: { truncated: true },
            outputText: JSON.stringify({
              success: true,
              data: {
                provider: 'brave',
                query: 'current agent search interfaces',
                searched_at: '2026-09-09T09:00:00.000Z',
                warnings: [],
                results: [
                  { title: 'Safe source', url: 'https://example.com/source' },
                  { title: 'Unsafe source', url: 'javascript:alert(1)' },
                ],
              },
            }),
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages, showFullTraces: true }),
    );

    expect(html).toContain('Searched the web');
    expect(html).toContain('current agent search interfaces');
    expect(html).toContain('Safe source');
    expect(html).toContain('1 source');
    expect(html).not.toContain('Unsafe source');
    expect(html).toContain('Worked · 1 step');
  });

  it('shows active research with a spinner, query, and completed source preview', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_research',
        role: 'assistant',
        run_id: 'run_research',
        parts: [
          {
            type: 'tool-runtime-web_search-1',
            state: 'completed',
            toolCallId: 'search_done',
            toolName: 'runtime-web_search-1',
            input: { query: 'Italy AI strategy' },
            output: {
              provider: 'brave',
              results: [{ title: 'Italy AI strategy', url: 'https://example.com/italy-ai' }],
            },
          },
          {
            type: 'tool-runtime-web_search-1',
            state: 'running',
            toolCallId: 'search_running',
            toolName: 'runtime-web_search-1',
            input: { query: 'Italian startup funding' },
          },
          { type: 'text', text: 'The first source is ready.' },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_research',
        isSubmitting: true,
        messages,
      }),
    );

    expect(html).toContain('chat-research-spinner');
    expect(html).toContain('chat-research-fade');
    expect(html).toContain('chat-research-source-fade');
    expect(html).toContain('Italian startup funding');
    expect(html).toContain('Italy AI strategy');
    expect(html).toContain('The first source is ready.');
  });

  it.each([
    {
      name: 'a stale running call',
      part: { state: 'running' },
      expected: ['Search stopped', 'The web search stopped before it finished.'],
    },
    {
      name: 'a failed call',
      part: { state: 'running', errorText: 'Provider failed.' },
      expected: ['Search failed', 'The web search failed.'],
    },
    {
      name: 'a denied call',
      part: { state: 'denied' },
      expected: ['Search not allowed', 'The web search was not allowed.'],
    },
    {
      name: 'a valid empty result',
      part: { state: 'completed', output: { provider: 'brave', results: [] } },
      expected: ['Searched the web', 'No web sources were found.'],
    },
    {
      name: 'an unreadable result',
      part: { state: 'completed', output: { truncated: true } },
      expected: ['Search results unavailable', 'Search results could not be displayed.'],
    },
    {
      name: 'an unavailable provider',
      part: { state: 'completed', output: { provider: 'none', results: [] } },
      expected: ['Web search unavailable', 'The web search service is unavailable.'],
    },
  ])('shows the correct web search state for $name', ({ part, expected }) => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_search_state',
        role: 'assistant',
        run_id: 'run_search_state',
        parts: [
          {
            type: 'tool-runtime-web_search-1',
            toolCallId: 'search_state',
            toolName: 'runtime-web_search-1',
            input: { query: 'current search state' },
            ...part,
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages, showFullTraces: true }),
    );

    for (const text of expected) expect(html).toContain(text);
    expect(html).not.toContain('Searching the web');
  });

  it('combines each message search batch without changing surrounding content order', () => {
    const result = (title: string, url: string) => ({ title, url });
    const search = (
      id: string,
      query: string,
      state: string,
      output?: unknown,
      errorText?: string,
    ): ProjectedChatToolPart => ({
      type: 'tool-runtime-web_search-1',
      toolCallId: id,
      toolName: 'runtime-web_search-1',
      input: { query },
      state,
      ...(output === undefined ? {} : { output }),
      ...(errorText ? { errorText } : {}),
    });
    const messages: ProjectedChatMessage[] = [
      {
        id: 'mixed_searches',
        role: 'assistant',
        run_id: 'run_mixed',
        parts: [
          { type: 'text', text: 'Before the searches.' },
          search('one', 'first query', 'completed', {
            provider: 'brave',
            results: [
              result('First source', 'https://one.example/a'),
              result('Second source', 'https://two.example/b'),
            ],
          }),
          { type: 'text', text: 'Between search calls.' },
          search('two', 'second query', 'completed', {
            provider: 'brave',
            results: [
              result('Duplicate source', 'https://one.example/a'),
              result('Unsafe source', 'javascript:alert(1)'),
              result('Third source', 'https://three.example/c'),
              result('Fourth source', 'https://four.example/d'),
            ],
          }),
          search('three', 'live query', 'running'),
          search('four', 'stopped query', 'cancelled'),
          search('five', 'denied query', 'denied'),
          search('six', 'failed query', 'running', undefined, 'Provider failed.'),
          { type: 'text', text: 'After the searches.' },
        ],
      },
      {
        id: 'next_search_message',
        role: 'assistant',
        parts: [
          search('seven', 'separate message query', 'completed', {
            provider: 'brave',
            results: [],
          }),
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_mixed',
        isSubmitting: true,
        messages,
        showFullTraces: true,
      }),
    );

    expect(count_occurrences(html, '<section')).toBe(2);
    expect(html).toContain('4 sources');
    expect(html).toContain('6 searches');
    expect(html).toContain('3 issues');
    expect(html).toContain('Searching the web');
    expect(html).toContain('Searching');
    expect(html).toContain('Stopped');
    expect(html).toContain('Not allowed');
    expect(html).toContain('Failed');
    expect(count_occurrences(html, 'href="https://one.example/a"')).toBe(1);
    expect(html).toContain('href="https://two.example/b"');
    expect(html).toContain('href="https://three.example/c"');
    expect(html).toContain('href="https://four.example/d"');
    expect(html).not.toContain('Unsafe source');
    expect(html.indexOf('Before the searches.')).toBeLessThan(
      html.indexOf('Between search calls.'),
    );
    expect(html.indexOf('Between search calls.')).toBeLessThan(html.indexOf('After the searches.'));
    expect(html.indexOf('After the searches.')).toBeLessThan(
      html.indexOf('separate message query'),
    );
  });

  it('docks a pending connection request above the composer, with a trace row in the transcript', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          connection_setup_tool_part({
            app_display_name: 'Slack',
            app_name: 'slack',
            start_url: 'https://app.example.com/connect/start?app_name=slack',
          }),
        ],
      },
    ];

    const html = render_conversation({
      connectedApps: {},
      isSubmitting: false,
      messages,
    });

    expect(html).toContain('Slack connection requested');
    expect(html).toContain('>Slack</span> to continue');
    expect(html).toContain('Not now');
    expect(html).toContain('https://app.example.com/connect/start?app_name=slack');
    expect(html).not.toContain('Tool call ID');
    expect(html).not.toContain('Worked');
  });

  it('names what the connection is allowed to do without promising a scope it cannot verify', () => {
    const html = render_conversation({
      connectedApps: {},
      isSubmitting: false,
      messages: connection_setup_messages(),
    });

    expect(html).toContain('Alfera only does what this connection allows.');
    expect(html).not.toContain('Read-only');
  });

  it('drops the dock bar for an app that is already connected, keeping only the trace row', () => {
    const html = render_conversation({
      connectedApps: { slack: 0 },
      isSubmitting: false,
      messages: connection_setup_messages(),
    });

    expect(html).toContain('Connected Slack');
    expect(html).not.toContain('Slack connection requested');
    expect(html).not.toContain('to continue');
    expect(html).not.toContain('Not now');
    expect(html).not.toContain('https://app.example.com/connect/start?app_name=slack');
  });

  it('still asks when the ask is newer than every connection for that app', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          {
            ...connection_setup_tool_part({
              app_display_name: 'Gmail',
              app_name: 'gmail',
              start_url: 'https://app.example.com/connect/start?app_name=gmail',
            }),
            createdTime: '2026-08-02T21:00:00.000Z',
          },
        ],
      },
    ];

    const html = render_conversation({
      connectedApps: { gmail: Date.parse('2026-07-01T09:00:00.000Z'), app_gmail: 0 },
      isSubmitting: false,
      messages,
    });

    expect(html).toContain('>Gmail</span> to continue');
    expect(html).toContain('https://app.example.com/connect/start?app_name=gmail');
    expect(html).toContain('Gmail connection requested');
    expect(html).not.toContain('Connected Gmail');
  });

  it('asks nothing until the connections query has answered', () => {
    const html = render_conversation({
      isSubmitting: false,
      messages: connection_setup_messages(),
    });

    expect(html).toContain('Slack connection requested');
    expect(html).not.toContain('Not now');
  });

  it('only asks for the connections of the newest assistant turn, and forgets dismissed ones', () => {
    const old_turn: ProjectedChatMessage = {
      id: 'msg_old',
      role: 'assistant',
      parts: [
        connection_setup_tool_part({
          app_display_name: 'Slack',
          app_name: 'slack',
          start_url: 'https://app.example.com/connect/start?app_name=slack',
        }),
      ],
    };
    const new_turn: ProjectedChatMessage = {
      id: 'msg_new',
      role: 'assistant',
      parts: [
        connection_setup_tool_part({
          app_display_name: 'Gmail',
          app_name: 'gmail',
          start_url: 'https://app.example.com/connect/start?app_name=gmail',
        }),
      ],
    };

    const requests = latest_connection_requests([old_turn, new_turn]);

    expect(requests.map((request) => request.app.app_name)).toEqual(['gmail']);
    expect(latest_connection_requests([old_turn, new_turn], ['gmail'])).toEqual([]);
  });

  it('docks one bar and one trace row when the same request arrives in both output shapes', () => {
    const start_url = 'https://app.example.com/connect/start?app_name=notion';
    const setup_payload = {
      type: 'connection_setup',
      app: { app_id: 'app_notion', app_name: 'notion', app_display_name: 'Notion' },
      start_url,
    };
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-runtime-create_connection-1',
            state: 'completed',
            toolCallId: 'run_1:tool:toolu_1',
            toolName: 'runtime-create_connection-1',
            output: { success: true, data: setup_payload },
          },
          {
            type: 'tool-runtime-create_connection-1',
            state: 'completed',
            toolCallId: 'tcall_1',
            toolName: 'runtime-create_connection-1',
            output: { content: [{ type: 'text', text: JSON.stringify(setup_payload) }] },
          },
        ],
      },
    ];

    const html = render_conversation({ connectedApps: {}, isSubmitting: false, messages });

    expect(count_occurrences(html, 'Notion connection requested')).toBe(2);
    expect(count_occurrences(html, 'to continue')).toBe(1);
    expect(html).not.toContain('Worked');
  });

  it('drops the dock bar when only the app_id matches an active connection', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          connection_setup_tool_part({
            app_display_name: 'Slack',
            app_name: 'slack_v2',
            start_url: 'https://app.example.com/connect/start?app_name=slack',
          }),
        ],
      },
    ];

    const html = render_conversation({
      connectedApps: { appslackv2: 0 },
      isSubmitting: false,
      messages,
    });

    expect(html).toContain('Connected Slack');
    expect(html).not.toContain('to continue');
  });

  it('hides duplicated connection setup link text when a connection trace row renders', () => {
    const card_url = 'https://app.example.com/connect/start?app_name=gmail&connection_name=Gmail';
    const card_url_html = card_url.replaceAll('&', '&amp;');
    const repeated_url =
      'http://app.localhost:3000/connect/start?app_name=gmail&connection_name=Gmail';
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          connection_setup_tool_part({
            app_display_name: 'Gmail',
            app_name: 'gmail',
            start_url: card_url,
          }),
          {
            type: 'text',
            text: [
              'Open this link to connect Gmail:',
              '',
              repeated_url,
              'If you want, I can also help connect a specific Google app only.',
            ].join('\n'),
          },
        ],
      },
    ];

    const html = render_conversation({
      connectedApps: {},
      isSubmitting: false,
      messages,
    });

    expect(html).toContain('Gmail connection requested');
    expect(html).toContain(card_url_html);
    expect(html).not.toContain(repeated_url);
    expect(html).not.toContain('Open this link to connect Gmail');
    expect(html).not.toContain('If you want');
    expect([
      ...html.matchAll(new RegExp(card_url_html.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')),
    ]).toHaveLength(1);
  });

  it('renders unresolved tool parts of a finished run as attempted, without a spinner', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: unresolved_gmail_messages(),
      }),
    );

    expect(html).toContain('Tried to find email');
    expect(html).not.toContain('animate-spin');
    expect(html).not.toContain('>attempted<');
    expect(html).not.toContain('text-destructive');
  });

  it('keeps unresolved tool parts running while their own run is still active', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: false,
        messages: unresolved_gmail_messages(),
      }),
    );

    expect(html).toContain('Finding email');
    expect(html).not.toContain('animate-spin');
    expect(html).toContain('chat-activity-breathe');
    expect(html).not.toContain('Tried to find email');
  });

  it('promotes the running tool of the active run and shows its last output line', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: [running_command_message('running')],
      }),
    );

    expect(html).toContain('w-full text-foreground');
    expect(html).toContain('Built 12 modules');
    expect(html).not.toContain('Compiling');
  });

  it('leaves a completed tool in the quiet register with no live line', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: [running_command_message('completed')],
      }),
    );

    expect(html).not.toContain('w-full text-foreground');
    expect(html).not.toContain('Built 12 modules');
  });

  it('labels attempted work without an app in past tense', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        run_id: 'run_1',
        parts: [
          {
            type: 'tool-workspace-exec_command',
            state: 'running',
            toolCallId: 'tool_run_1',
            toolName: 'workspace-exec_command',
          },
          {
            type: 'tool-workspace-exec_command',
            state: 'running',
            toolCallId: 'tool_run_2',
            toolName: 'workspace-exec_command',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages }),
    );

    expect(count_occurrences(html, 'Tried to run a command')).toBe(2);
  });

  it('shows one live panel for related file actions', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        run_id: 'run_1',
        parts: [
          {
            type: 'tool-workspace-write_file-1',
            input: { path: '/repo/src/a.ts' },
            state: 'running',
            toolCallId: 'tool_write_a',
            toolName: 'workspace-write_file-1',
          },
          {
            type: 'tool-workspace-write_file-1',
            input: { path: '/repo/src/b.ts' },
            state: 'completed',
            toolCallId: 'tool_write_b',
            toolName: 'workspace-write_file-1',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { activeRunId: 'run_1', isSubmitting: false, messages }),
    );

    expect(html).toContain('Files in progress');
    expect(html).toContain('2 actions · 1 issue');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('min-h-7');
    expect(html).not.toContain('border-border/60 bg-raised shadow-sm');
  });

  it('combines completed file actions into one panel', () => {
    const messages: ProjectedChatMessage[] = [
      {
        id: 'msg_assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-workspace-write_file-1',
            input: { path: '/repo/src/a.ts' },
            state: 'completed',
            toolCallId: 'tool_write_a',
            toolName: 'workspace-write_file-1',
          },
          {
            type: 'tool-workspace-write_file-1',
            input: { path: '/repo/src/b.ts' },
            state: 'completed',
            toolCallId: 'tool_write_b',
            toolName: 'workspace-write_file-1',
          },
          {
            type: 'tool-workspace-read_file-1',
            input: { path: '/repo/src/c.ts' },
            state: 'completed',
            toolCallId: 'tool_read_c',
            toolName: 'workspace-read_file-1',
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages }),
    );
    expect(html).toContain('>Files<');
    expect(html).toContain('3 actions · 3 issues');
    expect(count_occurrences(html, '>Files<')).toBe(1);
    expect(html).toContain('Worked · 3 steps');
    expect(html).toContain('aria-hidden="true"');
  });

  it('keeps the command row verb no matter its tense, mono command included', () => {
    const running_html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            run_id: 'run_1',
            parts: [
              {
                type: 'tool-workspace-run_command-1',
                input: { command: 'npm test' },
                state: 'running',
                toolCallId: 'tool_command',
                toolName: 'workspace-run_command-1',
              },
            ],
          },
        ],
      }),
    );
    const running_row = tool_rows(running_html).by_title('npm test');

    expect(running_row).toContain('Running');
    expect(running_row).toContain(
      '<span class="font-mono text-[13px] text-brand-ink">npm test</span>',
    );
  });

  it('renders a failed row in destructive red with its error clamped to one clause', () => {
    const long_error = `First line explaining exactly what broke in the tool call.
second line of a stack trace nobody reads on the timeline`;
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            parts: [
              {
                type: 'tool-workspace-run_command-1',
                errorText: long_error,
                input: { command: 'npm run build' },
                state: 'failed',
                toolCallId: 'tool_failed_build',
                toolName: 'workspace-run_command-1',
              },
            ],
          },
        ],
      }),
    );
    const row = tool_rows(html).by_title('npm run build');

    expect(row).toContain('text-destructive');
    expect(row).toContain('First line explaining exactly what broke in the tool call.');
    expect(row).not.toContain('second line of a stack trace');
  });

  it('keeps the connection request visible while related work stays folded', () => {
    const html = render_conversation({
      activeRunId: 'run_1',
      connectedApps: {},
      isSubmitting: false,
      messages: [
        {
          id: 'msg_assistant',
          role: 'assistant',
          run_id: 'run_1',
          parts: [
            {
              type: 'tool-gmail-find_email-1',
              display: { appName: 'gmail', title: 'Find email', subtitle: 'Gmail' },
              state: 'running',
              toolCallId: 'tool_running',
              toolName: 'gmail-find_email-1',
            },
            connection_setup_tool_part({
              app_display_name: 'Gmail',
              app_name: 'gmail',
              start_url: 'https://app.example.com/connect/start?app_name=gmail',
            }),
          ],
        },
      ],
    });

    expect(html).toContain('Gmail connection requested');
    expect(html).toContain('Worked so far');
  });

  it('flips the connection trace row to "Connected {App}" once the ask resolves', () => {
    const html = render_conversation({
      connectedApps: { slack: 0 },
      isSubmitting: false,
      messages: connection_setup_messages(),
    });

    expect(html).toContain('Connected Slack');
    expect(html).not.toContain('Slack connection requested');
  });

  it('names the running tool in the pinned work dock', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: unresolved_gmail_messages(),
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Working in Gmail');
    expect(html).not.toContain('Working in Gmail…');
  });

  it('keeps every tool in a parallel batch breathing, with one of them on stage', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: parallel_batch_messages(mixed_parallel_batch()),
      }),
    );

    const rows = tool_rows(html);
    expect(rows.by_title('Finding email')).toContain('chat-activity-breathe');
    expect(rows.by_title('Searching pages')).toContain('chat-activity-breathe');
    expect(html).toContain('Files in progress');
    expect(html.split('chat-activity-breathe')).toHaveLength(3);
    expect(count_occurrences(html, 'chat-working-dot size-[7px]')).toBe(3);
    expect(count_occurrences(html, 'role="status"')).toBe(1);
  });

  it('names a parallel batch by its apps, then by its count', () => {
    const dock_label = (parts: ProjectedChatMessage['parts']) => {
      const html = renderToStaticMarkup(
        createElement(ChatConversation, {
          activeRunId: 'run_1',
          isSubmitting: true,
          messages: parallel_batch_messages(parts),
        }),
      );
      return html.split('role="status">')[1]?.split('</div>')[0] ?? '';
    };

    expect(
      dock_label([
        running_app_tool_part('gmail', 'Find email', 'Gmail'),
        running_app_tool_part('notion', 'Search pages', 'Notion'),
      ]),
    ).toContain('Working in Gmail + Notion');

    expect(dock_label(mixed_parallel_batch())).toContain('Running 3 actions');
  });

  it.each([
    ['running', true, 'Running 3 actions'],
    ['completed', false, 'Worked · 3 steps'],
  ] as const)('names mixed integration work without file claims when %s', (state, is_active, label) => {
    const parts = (
      [
        ['gmail', 'Update thread', 'Gmail'],
        ['notion', 'Read policy', 'Notion'],
        ['zendesk', 'Update ticket', 'Zendesk'],
      ] as const
    ).map(([app_name, title, subtitle]) => ({
      type: `tool-${app_name}-1` as const,
      display: { appName: app_name, title, subtitle },
      toolCallId: `tool_${app_name}`,
      toolName: `${app_name}-1`,
      state,
    }));
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        ...(is_active ? { activeRunId: 'run_1' } : {}),
        isSubmitting: is_active,
        messages: parallel_batch_messages(parts),
      }),
    );
    expect(html).toContain(label);
    expect(html).not.toContain('Editing 2 files');
    expect(html).not.toContain('Edited 2 files');
  });

  it('keeps a sweeping line under a staged tool that has printed nothing yet', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: unresolved_gmail_messages(),
      }),
    );

    expect(html).not.toContain('chat-activity-sweep');
  });

  it('empties the work dock once the run ends', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: unresolved_gmail_messages(),
      }),
    );

    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('Working in Gmail…');
  });

  it('says Thinking in the work dock while reasoning streams with no running tool', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            run_id: 'run_1',
            parts: [{ type: 'reasoning', text: 'Weighing the options.', state: 'streaming' }],
          },
        ],
      }),
    );

    expect(html).toContain('Thinking…');
  });

  it('renders the workspace memory recall as one quiet timeline row', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            run_id: 'run_1',
            parts: [
              {
                type: 'source',
                sourceId: 'workspace_memory_recall',
                title: 'Workspace memory',
                citationText: '14 facts · 3 about this person',
              },
              { type: 'text', text: 'Here is what I found.' },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Read workspace memory');
    expect(html).toContain('14 facts · 3 about this person');
    expect(html.indexOf('Read workspace memory')).toBeLessThan(
      html.indexOf('Here is what I found.'),
    );
  });

  it('falls back to the title for a source that is not workspace memory', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_assistant',
            role: 'assistant',
            run_id: 'run_1',
            parts: [
              {
                type: 'source',
                sourceId: 'doc_42',
                title: 'Q3 revenue plan',
                citationText: 'page 4',
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Q3 revenue plan');
    expect(html).toContain('page 4');
    expect(html).not.toContain('Read workspace memory');
  });

  it('describes running work by its action instead of its tool id', () => {
    const dock_label = (part: ProjectedChatMessage['parts'][number]) => {
      const html = renderToStaticMarkup(
        createElement(ChatConversation, {
          activeRunId: 'run_1',
          isSubmitting: true,
          messages: [{ id: 'msg_assistant', role: 'assistant', run_id: 'run_1', parts: [part] }],
        }),
      );
      return html.split('role="status">')[1]?.split('</div>')[0] ?? '';
    };

    const listing_files = dock_label(
      workspace_tool_part('workspace-list_files-1', { path: '/repo/src' }),
    );
    expect(listing_files).toContain('Listing files');
    expect(listing_files).not.toContain('Listing files…');

    const writing_plan = dock_label(
      workspace_tool_part('workspace-write_file-1', { path: '/repo/src/plan.md' }),
    );
    expect(writing_plan).toContain('Writing');
    expect(writing_plan).toContain('>plan.md<');

    const reading_plan = dock_label(
      workspace_tool_part('workspace-read_file-1', { path: '/repo/src/plan.md' }),
    );
    expect(reading_plan).toContain('Reading');
    expect(reading_plan).toContain('>plan.md<');

    const running_ls = dock_label(
      workspace_tool_part('workspace-run_command-1', { command: 'ls' }),
    );
    expect(running_ls).toContain('Running');
    expect(running_ls).toContain('>ls<');
    expect(running_ls).not.toContain('Running a command');

    const starting_preview = dock_label(workspace_tool_part('workspace-preview-1', {}));
    expect(starting_preview).toContain('Starting a preview');
    expect(starting_preview).not.toContain('Starting a preview…');
  });

  it('does not hide assistant text when it does not duplicate a rendered connection URL', () => {
    expect(assistant_text_for_display('Open https://example.com/report', [])).toBe(
      'Open https://example.com/report',
    );
  });

  it('asks a present_choices call in the dock above the composer, never in the thread', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: choice_messages(),
        isChoiceAnswerable: true,
        onChoiceAnswer: () => Promise.resolve(true),
      }),
    );

    expect(html).toContain('Publish both drafts, or just the newsletter?');
    expect(html).toContain('Publish both');
    expect(html).toContain('Newsletter only');
    expect(html).toContain('Goes live to 4,200 subscribers today.');
    const recommended_row = html.split('Publish both</span>')[0] ?? '';
    expect(recommended_row.slice(recommended_row.lastIndexOf('<button'))).toContain('bg-hover');
    expect(html).toContain('Something else');
    expect(html).toContain('Skip');
    expect(html).toContain('Asked you to choose');
    expect(html).not.toContain('1 of ');
    expect(html.indexOf('Asked you to choose')).toBeLessThan(html.indexOf('Something else'));
  });

  it('pages a three-question interview and keeps every question answerable', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: interview_messages(),
        isChoiceAnswerable: true,
        onChoiceAnswer: () => Promise.resolve(true),
      }),
    );

    expect(html).toContain('How often should it run?');
    expect(html).toContain('1 of 3');
    expect(html).not.toContain('Which city?');
    expect(html).toContain('Next question');
    expect(combined_choice_reply(three_questions, ['Weekly', null, 'Just me'])).toBe(
      [
        'How often should it run: Weekly',
        'Which city: skipped - make a reasonable assumption and tell me which one you made',
        'Who sees it: Just me',
      ].join('\n\n'),
    );
    expect(combined_choice_reply(three_questions.slice(0, 1), ['Weekly'])).toBe('Weekly');
  });

  it('answers a wholly skipped interview instead of leaving the run parked on it', () => {
    expect(combined_choice_reply(three_questions, [null, null, null])).toBe(
      [
        'How often should it run: skipped - make a reasonable assumption and tell me which one you made',
        'Which city: skipped - make a reasonable assumption and tell me which one you made',
        'Who sees it: skipped - make a reasonable assumption and tell me which one you made',
      ].join('\n\n'),
    );
    expect(combined_choice_reply(three_questions.slice(0, 1), [null])).toBe(
      'skipped - make a reasonable assumption and tell me which one you made',
    );
    const last = record_choice_answer(three_questions, [null, null], 2, null);
    expect(last.reply).not.toBe('');
  });

  it('takes the rows out of reach while the answer has nowhere to go', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isChoiceAnswerable: false,
        isSubmitting: false,
        messages: choice_messages(),
        onChoiceAnswer: () => Promise.resolve(true),
      }),
    );

    expect(html).toContain('Publish both drafts, or just the newsletter?');
    expect(html).toContain('Getting ready to take your answer');
    expect(html).toContain('Publish both');
    expect(choice_rows_tag(html)).toContain('disabled=""');
    expect(html).toContain('aria-label="Answer the rest as skipped"');

    const answerable = renderToStaticMarkup(
      createElement(ChatConversation, {
        isChoiceAnswerable: true,
        isSubmitting: false,
        messages: choice_messages(),
        onChoiceAnswer: () => Promise.resolve(true),
      }),
    );
    expect(answerable).not.toContain('Getting ready to take your answer');
    expect(choice_rows_tag(answerable)).not.toContain('disabled=""');
  });

  it('sends nothing until the last question of an interview is answered', () => {
    const picked = record_choice_answer(three_questions, [], 0, 'Weekly');
    expect(picked.reply).toBe('');
    expect(picked.next_question_index).toBe(1);

    const typed = record_choice_answer(three_questions, picked.answers, 1, 'Milan');
    expect(typed.reply).toBe('');
    expect(typed.next_question_index).toBe(2);

    const last = record_choice_answer(three_questions, typed.answers, 2, null);
    expect(last.next_question_index).toBe(2);
    expect(last.reply).toBe(
      [
        'How often should it run: Weekly',
        'Which city: Milan',
        'Who sees it: skipped - make a reasonable assumption and tell me which one you made',
      ].join('\n\n'),
    );
  });

  it('gives a text question a typed box instead of options that ask you to share something', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: choice_call_messages([three_questions[1]]),
        isChoiceAnswerable: true,
        onChoiceAnswer: () => Promise.resolve(true),
      }),
    );

    expect(html).toContain('Which city?');
    expect(html).toContain('placeholder="Milan"');
    expect(html).toContain('border-dashed');
    expect(html).toContain('Skip');
    expect(html).not.toContain('Something else');
  });

  it('closes the dock and keeps one answered line once the call carries its answer', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: choice_messages({}, { answer: 'Newsletter only' }),
        isChoiceAnswerable: true,
        onChoiceAnswer: () => Promise.resolve(true),
      }),
    );

    expect(html).not.toContain('Something else');
    expect(html).not.toContain('Asked you to choose');
    expect(html).toContain('Publish both drafts, or just the newsletter?');
    expect(html).toContain('Newsletter only');
  });

  it('stops claiming to wait once a call nobody answered has settled', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: choice_messages({}, {}),
        isChoiceAnswerable: true,
        onChoiceAnswer: () => Promise.resolve(true),
      }),
    );

    expect(html).toContain('nobody answered');
    expect(html).not.toContain('waiting for your answer');
    expect(html).not.toContain('Something else');
  });

  it('refuses to draw a panel for a choice call that breaks the contract', () => {
    const broken_calls = [
      choice_messages({ recommended_option: 'Publish everything' }),
      choice_messages({
        options: ['One', 'Two', 'Three', 'Four', 'Five'].map((label) => ({ label })),
      }),
      choice_messages({ options: undefined, recommended_option: undefined }),
      choice_messages({ kind: 'text' }),
    ];

    for (const messages of broken_calls) {
      const html = renderToStaticMarkup(
        createElement(ChatConversation, {
          isSubmitting: false,
          messages,
          isChoiceAnswerable: true,
          onChoiceAnswer: () => Promise.resolve(true),
        }),
      );
      expect(html).not.toContain('Something else');
      expect(html).not.toContain('Asked you to choose');
    }
  });
});

function choice_rows_tag(html: string) {
  const start = html.indexOf('<fieldset');
  return start === -1 ? '' : html.slice(start, html.indexOf('>', start) + 1);
}

function choice_messages(
  overrides: Record<string, unknown> = {},
  settled?: { answer?: string },
): ProjectedChatMessage[] {
  return choice_call_messages(
    [
      {
        kind: 'choice',
        question: 'Publish both drafts, or just the newsletter?',
        options: [
          { label: 'Publish both', description: 'The blog post goes out too.' },
          { label: 'Newsletter only' },
        ],
        recommended_option: 'Publish both',
        stakes: 'Goes live to 4,200 subscribers today.',
        ...overrides,
      },
    ],
    settled,
  );
}

const three_questions: PresentChoicesQuestion[] = [
  {
    kind: 'choice',
    question: 'How often should it run?',
    options: [{ label: 'Weekly' }, { label: 'Daily' }],
    recommended_option: 'Weekly',
  },
  {
    kind: 'text',
    question: 'Which city?',
    placeholder: 'Milan',
  },
  {
    kind: 'choice',
    question: 'Who sees it?',
    options: [{ label: 'Just me' }, { label: 'The whole team' }],
    recommended_option: 'Just me',
  },
];

function interview_messages(): ProjectedChatMessage[] {
  return choice_call_messages(three_questions);
}

function choice_call_messages(
  questions: unknown[],
  settled?: { answer?: string },
): ProjectedChatMessage[] {
  return [
    {
      id: 'msg_assistant',
      role: 'assistant',
      run_id: 'run_1',
      parts: [
        { type: 'text', text: 'Both drafts are ready.' },
        {
          type: 'tool-chat-present_choices-1',
          state: settled ? 'completed' : 'executing',
          toolCallId: 'tool_choice',
          toolName: 'chat-present_choices-1',
          input: { questions },
          ...(settled
            ? {
                output: {
                  success: true,
                  data: settled.answer
                    ? { questions, answered: true, answer: settled.answer }
                    : { questions, answered: false },
                },
              }
            : {}),
        },
      ],
    },
  ];
}

function tool_rows(html: string) {
  const rows = html
    .split('<button class="group/activity-row')
    .slice(1)
    .map((section) => section.split('</button>')[0] ?? '');

  return {
    by_title: (title: string) => rows.find((row) => row.includes(title)) ?? '',
  };
}

function workspace_tool_part(
  tool_name: string,
  input: Record<string, unknown>,
): ProjectedChatMessage['parts'][number] {
  return {
    type: `tool-${tool_name}`,
    input,
    state: 'running',
    toolCallId: `tool_${tool_name}`,
    toolName: tool_name,
  };
}

function parallel_batch_messages(parts: ProjectedChatMessage['parts']): ProjectedChatMessage[] {
  return [{ id: 'msg_assistant', role: 'assistant', run_id: 'run_1', parts }];
}

function mixed_parallel_batch(): ProjectedChatMessage['parts'] {
  return [
    running_app_tool_part('gmail', 'Find email', 'Gmail'),
    running_app_tool_part('notion', 'Search pages', 'Notion'),
    workspace_tool_part('workspace-list_files-1', { path: '/repo/src' }),
  ];
}

function running_app_tool_part(
  app_name: string,
  title: string,
  subtitle: string,
): ProjectedChatMessage['parts'][number] {
  return {
    type: `tool-${app_name}-1`,
    display: { appName: app_name, subtitle, title },
    state: 'running',
    toolCallId: `tool_${app_name}`,
    toolName: `${app_name}-1`,
  };
}

function unresolved_gmail_messages(): ProjectedChatMessage[] {
  return [
    {
      id: 'msg_assistant',
      role: 'assistant',
      run_id: 'run_1',
      parts: [
        {
          type: 'tool-gmail-find_email-1',
          display: { appName: 'gmail', title: 'Find email', subtitle: 'Gmail' },
          state: 'running',
          toolCallId: 'tool_running',
          toolName: 'gmail-find_email-1',
        },
      ],
    },
  ];
}

function render_conversation(props: Parameters<typeof ChatConversation>[0]) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ChatConversation, props),
    ),
  );
}

function count_occurrences(html: string, needle: string) {
  return html.split(needle).length - 1;
}

function connection_setup_tool_part(input: {
  app_display_name: string;
  app_name: string;
  start_url: string;
}): ProjectedChatToolPart {
  return {
    type: 'tool-runtime-create_connection-1',
    state: 'completed',
    toolCallId: `tool_${input.app_name}`,
    toolName: 'runtime-create_connection-1',
    output: {
      success: true,
      data: {
        type: 'connection_setup',
        app: {
          app_id: `app_${input.app_name}`,
          app_name: input.app_name,
          app_display_name: input.app_display_name,
          description: 'Team messaging',
        },
        start_url: input.start_url,
      },
    },
  };
}

function connection_setup_messages(): ProjectedChatMessage[] {
  return [
    {
      id: 'msg_assistant',
      role: 'assistant',
      parts: [
        connection_setup_tool_part({
          app_display_name: 'Slack',
          app_name: 'slack',
          start_url: 'https://app.example.com/connect/start?app_name=slack',
        }),
      ],
    },
  ];
}

function running_command_message(state: string): ProjectedChatMessage {
  return {
    id: 'msg_assistant',
    role: 'assistant',
    run_id: 'run_1',
    parts: [
      {
        type: 'tool-workspace-run_command-1',
        input: { command: 'pnpm build' },
        outputText: 'Compiling\nBuilt 12 modules\n',
        state,
        toolCallId: 'tool_command',
        toolName: 'workspace-run_command-1',
      },
    ],
  };
}

function catalog_app(input: {
  app_display_name: string;
  app_name: string;
  icon_url: string;
}): CatalogApp {
  return {
    app_id: `app_${input.app_name}`,
    app_display_name: input.app_display_name,
    app_name: input.app_name,
    app_status: 'active',
    catalog_scope: 'global',
    display_config: { icon_url: input.icon_url },
    metadata: {},
  } as unknown as CatalogApp;
}

describe('a finished turn folds its working-out behind the answer', () => {
  const working_turn: ProjectedChatMessage[] = [
    {
      id: 'msg_assistant',
      role: 'assistant',
      run_id: 'run_1',
      parts: [
        { type: 'reasoning', text: 'Weighing which ledger to read.', state: 'complete' },
        {
          type: 'tool-workspace-read_file',
          toolName: 'workspace-read_file',
          toolCallId: 'call_1',
          state: 'output-available',
          input: { path: 'ledger.csv' },
          output: 'ok',
        } as ProjectedChatToolPart,
        { type: 'text', text: 'On it, reading the ledger now.' },
        { type: 'text', text: 'Reconciled 412 payouts. Two mismatches attached.' },
      ],
    },
  ];

  it('keeps every contiguous final text block outside the fold', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages: working_turn }),
    );

    expect(html).toContain('Reconciled 412 payouts.');
    expect(html).toContain('On it, reading the ledger now.');
    expect(html).toContain('aria-hidden="true"');
  });

  it('offers a way back to the detail, and says what is behind it', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, { isSubmitting: false, messages: working_turn }),
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Worked · 1 step');
    expect(html).toContain('Files stopped');
    expect(html).toContain('aria-expanded="false"');
  });

  it('collapses live work while keeping the trailing text visible', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: working_turn,
      }),
    );

    expect(html).toContain('Worked so far');
    expect(html).toContain('On it, reading the ledger now.');
    expect(html).toContain('Reconciled 412 payouts.');
    expect(html).toContain('aria-hidden="true"');
  });

  it('opens all existing trace detail in full trace mode', () => {
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        activeRunId: 'run_1',
        isSubmitting: true,
        messages: working_turn,
        showFullTraces: true,
      }),
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('ledger.csv');
    expect(html).toContain('aria-hidden="false"');
  });

  it('renders an active empty transcript with a footer', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ChatConversation, {
          activeRunId: 'run_1',
          footer: createElement('div', null, 'Browser preview'),
          isSubmitting: true,
          messages: [],
        }),
      ),
    ).not.toThrow();
  });
});

describe('internal tool panels', () => {
  const render_tools = (
    parts: ProjectedChatToolPart[],
    options: { isSubmitting?: boolean; showFullTraces?: boolean } = {},
  ) =>
    renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: options.isSubmitting ?? false,
        messages: [{ id: 'msg_internal_tools', role: 'assistant', parts }],
        ...(options.showFullTraces ? { showFullTraces: true } : {}),
      }),
    );

  const tool = (
    toolName: string,
    toolCallId: string,
    input: unknown,
    output: unknown,
    state = 'completed',
  ): ProjectedChatToolPart => ({
    type: `tool-${toolName}`,
    toolCallId,
    toolName,
    state,
    input,
    output,
  });

  it('groups and deduplicates file results from canonical and Pi tools', () => {
    const html = render_tools(
      [
        tool('workspace-glob', 'glob_1', { pattern: '**/*.tsx' }, ['src/app.tsx', 'src/page.tsx']),
        tool(
          'find',
          'find_1',
          { pattern: '**/*.tsx' },
          {
            content: [{ type: 'text', text: 'src/app.tsx\nsrc/layout.tsx' }],
          },
        ),
      ],
      { showFullTraces: true },
    );

    expect(html).toContain('Files');
    expect(html).toContain('2 actions');
    expect(count_occurrences(html, 'src/app.tsx')).toBe(2);
    expect(html).toContain('src/layout.tsx');
  });

  it('names oversized tool search results from their node key, without paging fields', () => {
    const html = render_tools(
      [
        tool(
          'runtime-search_tools-1',
          'search_1',
          { query: 'create spreadsheet' },
          {
            query: 'create spreadsheet',
            result_count: 17,
            tools: [
              { node_key: 'googlesheets-create_spreadsheet-1', requires_connection: true },
              { node_key: 'googlesheets-update_values-2' },
            ],
            fallback_tools: [],
            has_more: true,
            next_offset: 16,
          },
        ),
      ],
      { showFullTraces: true },
    );

    expect(html).toContain('Create spreadsheet');
    expect(html).toContain('Update values');
    expect(html).not.toContain('>Tool<');
    expect(html).not.toContain('Next offset');
    expect(html).not.toContain('More results');
  });

  it('names each expanded call by what it did, not by its family and "Complete"', () => {
    const html = render_tools(
      [
        tool('workspace-list_files', 'list_1', { path: 'daily-logs' }, [
          { path: 'daily-logs/2026-09-21.md', name: '2026-09-21.md', kind: 'file' },
          { path: 'daily-logs/archive', name: 'archive', kind: 'directory' },
        ]),
      ],
      { showFullTraces: true },
    );

    expect(count_occurrences(html, 'Listed daily-logs')).toBe(2);
    expect(html).not.toContain('Complete');
    expect(html).toContain('directory');
    expect(count_occurrences(html, '>file<')).toBe(0);
  });

  it('gives a later call from the same family its own panel after the agent moves on', () => {
    const list = tool('workspace-list_files', 'list_1', { path: 'daily-logs' }, []);
    const grep = tool('workspace-grep', 'grep_1', { path: 'daily-logs' }, []);
    const read = tool('workspace-read_file', 'read_1', { path: 'notes.md' }, { text: 'Notes' });
    const html = renderToStaticMarkup(
      createElement(ChatConversation, {
        isSubmitting: false,
        messages: [
          {
            id: 'msg_internal_tools',
            role: 'assistant',
            parts: [list, grep, { type: 'text', text: 'Now reading your notes.' }, read],
          },
        ],
        showFullTraces: true,
      }),
    );

    expect(count_occurrences(html, '>Files</span>')).toBe(2);
    expect(count_occurrences(html, '2 actions')).toBe(1);
    expect(html).toContain('Read notes.md');
  });

  it('renders real file, image, preview, and browser output shapes', () => {
    const html = render_tools(
      [
        tool('workspace-list_files', 'list_1', { path: 'src' }, [
          { path: 'src/app.tsx', name: 'app.tsx', kind: 'file' },
        ]),
        tool('workspace-read_file', 'read_1', { path: 'notes.txt' }, { text: 'Release notes' }),
        tool(
          'workspace-read_document',
          'document_1',
          { path: 'brief.docx' },
          {
            text: '# Brief\nShip Friday.',
          },
        ),
        tool('workspace-grep', 'grep_1', { pattern: 'TODO' }, [
          { path: 'src/app.tsx', line: 8, text: '// TODO: refine' },
        ]),
        tool('workspace-edit_file', 'edit_1', { path: 'src/app.tsx' }, { replacements: 2 }),
        tool(
          'workspace-write_file',
          'write_1',
          { path: 'notes.txt' },
          { text: 'Wrote /work/notes.txt' },
        ),
        tool(
          'workspace-view_image',
          'image_1',
          { path: 'chart.png' },
          {
            summary: 'Viewing chart.png (image/png, 10x10, 1KB).',
            image: { mime_type: 'image/png' },
          },
        ),
        tool(
          'workspace-preview',
          'preview_1',
          {},
          {
            preview_url: 'https://preview.example.com',
            port: 3000,
          },
        ),
        tool('browser', 'browser_1', { command: 'open https://example.com' }, 'Example Domain'),
      ],
      { showFullTraces: true },
    );

    for (const text of [
      'app.tsx',
      'Release notes',
      'Ship Friday.',
      'src/app.tsx:8',
      'Replacements',
      'Wrote /work/notes.txt',
      'Image result for chart.png',
      'preview.example.com',
      'Example Domain',
    ]) {
      expect(html).toContain(text);
    }
  });

  it('keeps mixed states and output text fallback visible', () => {
    const fallback = tool('workspace-grep', 'grep_fallback', { pattern: 'budget' }, undefined);
    fallback.outputText = JSON.stringify([{ path: 'plan.md', line: 4, text: 'Budget: 500' }]);
    const failed = tool(
      'workspace-read_file',
      'read_failed',
      { path: 'missing.txt' },
      undefined,
      'failed',
    );
    failed.errorText = 'The file does not exist.';

    const html = render_tools(
      [
        fallback,
        failed,
        tool('workspace-glob', 'glob_running', { pattern: '**/*' }, undefined, 'running'),
        tool(
          'workspace-edit_file',
          'edit_waiting',
          { path: 'plan.md' },
          undefined,
          'awaiting_approval',
        ),
        tool('workspace-write_file', 'write_stopped', { path: 'plan.md' }, undefined, 'cancelled'),
      ],
      { showFullTraces: true },
    );

    expect(html).toContain('plan.md:4');
    expect(html).toContain('Files waiting');
    expect(html).toContain('5 actions · 4 issues');
    expect(html).toContain('The file does not exist.');
    expect(html).toContain('Waiting for approval');
    expect(html).toContain('Stopped');
  });

  it('rejects unsafe output and does not print sensitive browser input', () => {
    const html = render_tools(
      [
        tool(
          'workspace-preview',
          'preview_unsafe',
          {},
          {
            preview_url: 'javascript:alert(1)',
            port: 3000,
          },
        ),
        tool(
          'browser',
          'browser_secret',
          { command: 'fill @e3 "password-123"' },
          { unexpected: true },
        ),
        tool(
          'read',
          'read_bad_image',
          { path: 'payload.svg' },
          {
            content: [{ type: 'image', data: '<svg onload=alert(1)>', mimeType: 'image/svg+xml' }],
          },
        ),
      ],
      { showFullTraces: true },
    );

    expect(html).toContain('2 actions · 2 issues');
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('password-123');
    expect(html).not.toContain('&lt;svg');
  });

  it.each([
    [
      'runtime-read_url-1',
      { url: 'https://example.com' },
      {
        provider: 'jina',
        title: 'Report',
        content: 'Result',
        url: 'https://example.com',
        content_characters: 6,
        truncated: false,
        warnings: [],
      },
      'Pages',
      'Result',
    ],
    [
      'runtime-image_search-1',
      { query: 'Rome' },
      {
        query: 'Rome',
        provider: 'wikimedia',
        warnings: [],
        results: [
          {
            title: 'Rome',
            image_url: 'https://example.com/rome.png',
            source_page_url: 'https://example.com/rome',
          },
        ],
      },
      'Images',
      'Rome',
    ],
    [
      'runtime-search_context-1',
      { query: 'budget' },
      {
        answer: 'One result',
        query: 'budget',
        result_count: 1,
        results: [{ message_role: 'user', message_sequence: 4, snippet: 'Budget 500' }],
      },
      'Chat history',
      'Budget 500',
    ],
    [
      'runtime-search_tools-1',
      { query: 'email' },
      {
        query: 'email',
        result_count: 1,
        tools: [
          {
            app_name: 'gmail',
            node_name: 'send_email',
            description: 'Send email',
            connection_status: 'connected',
          },
        ],
        fallback_tools: [],
        has_more: false,
        next_offset: null,
      },
      'Tools',
      'Send email',
    ],
    [
      'runtime-get_tool_schema-1',
      {},
      {
        app_name: 'gmail',
        node_name: 'send_email',
        description: 'Send email',
        requires_connection: true,
        input_schema: { properties: {}, required: [] },
      },
      'Tools',
      'Send email',
    ],
    [
      'runtime-list_tool_field_options-1',
      {},
      {
        field_name: 'channel',
        options: [{ label: 'General', value: 'C1' }],
        next_page_context: null,
      },
      'Tools',
      'General',
    ],
    [
      'runtime-load_skill-1',
      {},
      {
        skill_slug: 'research',
        skill_name: 'Research',
        content: 'Use sources.',
        preloaded_tools: [],
        resources: [],
      },
      'Skills',
      'Use sources.',
    ],
    [
      'runtime-list_connections-1',
      {},
      {
        result_count: 1,
        connections: [
          {
            app_display_name: 'Gmail',
            external_account_name: 'team@example.com',
            connection_status: 'active',
            health_status: 'healthy',
            accessible: true,
          },
        ],
      },
      'Connections',
      'team@example.com',
    ],
    [
      'runtime-add_mcp_server-1',
      {},
      { kind: 'connected', app_name: 'Linear', tool_count: 12, message_for_user: 'Connected.' },
      'Connections',
      'Connected.',
    ],
    [
      'runtime-propose_app_sign_in-1',
      {},
      { ready: false, because: 'No page.', message_for_user: 'Could not connect.' },
      'Connections',
      'No page.',
    ],
    [
      'runtime-refresh_app_credential-1',
      {},
      {
        refreshed: false,
        host: 'api.example.com',
        message: 'Unavailable.',
        exchanged: true,
        attached_to_the_wrong_sandbox: true,
      },
      'Connections',
      'Unavailable.',
    ],
    [
      'runtime-read_attachment-1',
      {},
      {
        path: 'uploads/brief.pdf',
        file_name: 'brief.pdf',
        mime_type: 'application/pdf',
        byte_size: 245000,
      },
      'Files',
      'brief.pdf',
    ],
    [
      'runtime-save_procedure_rule-1',
      { procedure_slug: 'buy', rule_key: 'discount', rule_value: '15%' },
      {
        outcome: 'replaced',
        previous_value: '10%',
        rules_path: 'skills/buy/rules.md',
        total_rules: 4,
      },
      'Skills',
      '15%',
    ],
    [
      'runtime-set_agent_name-1',
      {},
      { agent_name: 'Jarvis', summary: 'Renamed to Jarvis.' },
      'Assistant',
      'Jarvis',
    ],
    [
      'math-calculate-1',
      { expression: '1/3' },
      {
        expression: '1/3',
        result: '0.333333',
        fraction: '1/3',
        exact: false,
        rounded: true,
        decimal_places: 6,
      },
      'Calculation',
      '0.333333',
    ],
  ] as const)('renders the %s adapter through the conversation', (name, input, output, family, result) => {
    const html = render_tools([tool(name, `call_${name}`, input, output)], {
      showFullTraces: true,
    });
    expect(html).toContain(family);
    expect(html).toContain(result);
    expect(html).not.toContain('Result unavailable');
  });

  it('reads plain output text and reports a completed failure envelope', () => {
    const read = tool('workspace-read_file', 'read_' + 'text', { path: 'notes.txt' }, undefined);
    read.outputText = 'A plain file result.';
    const calculation = tool(
      'math-calculate-1',
      'division_by_zero',
      { expression: '1/0' },
      undefined,
    );
    calculation.outputText = JSON.stringify({
      success: false,
      error: { code: 'division_by_zero', message: 'Division by zero.' },
    });

    const html = render_tools([read, calculation], { showFullTraces: true });

    expect(html).toContain('A plain file result.');
    expect(html).toContain('Division by zero.');
    expect(html).toContain('Calculation failed');
    expect(html).not.toContain('Result unavailable');
  });

  it('leaves catalog execution on the existing generic tool row', () => {
    const html = render_tools([
      tool(
        'runtime-execute_tool-1',
        'execute_1',
        { node_key: 'gmail-send_email-1', input: { to: 'team@example.com' } },
        { success: true },
      ),
    ]);

    expect(html).toContain('Completed an action');
    expect(html).not.toContain('Call details');
  });
});

function local_time_of(year: number, month: number, day: number, hour: number) {
  return new Date(year, month - 1, day, hour).toISOString();
}

// `/projects/$project_id/edit` plus { project_id } is `/projects/proj_mkt/edit`; the optional
// `{-$session_id}` segment drops out when no id was passed, the same as the router's own.
type StubLinkProps = {
  to?: string;
  href?: string;
  params?: Record<string, string> | undefined;
  preload?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
};

function stub_link_href(to: string, params: Record<string, string> | undefined) {
  return to
    .replace(/\{-\$(\w+)\}/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\$(\w+)/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\/$/u, '');
}
