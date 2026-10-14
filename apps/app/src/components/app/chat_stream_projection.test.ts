import { create_external_source_actor, create_platform_source_actor } from '@coworker/shared';
import { describe, expect, it } from 'vitest';
import type { ChatToolCall } from '@/components/app/chat_stream_projection';
import {
  apply_chat_stream_event_to_thread,
  chat_thread_artifact_items,
  chat_thread_assistant_message_items,
  chat_thread_generative_ui_items,
  chat_thread_source_items,
  chat_thread_streaming_text,
  chat_thread_streaming_thinking,
  chat_thread_thinking_activity,
  chat_thread_thinking_items,
  chat_thread_tool_calls,
  create_empty_chat_thread_projection,
  create_projected_chat_messages,
  merge_chat_tool_calls,
} from '@/components/app/chat_stream_projection';
import type { CatalogNode, ChatStreamEvent, RunMessage, ToolCall } from '@/lib/api';

describe('chat stream projection', () => {
  it('projects user text as one user message', () => {
    const messages = create_projected_chat_messages({
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          text: 'Check my unread email.',
        }),
      ],
      tool_calls: [],
    });

    expect(messages).toEqual([
      {
        id: 'msg_user',
        role: 'user',
        parts: [{ type: 'text', text: 'Check my unread email.' }],
        sent_time: '2026-06-16T00:00:00.000Z',
      },
    ]);
  });

  it('projects an attached image above the text it was sent with', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({ message_role: 'user', run_message_id: 'msg_user', text: 'yo' }),
          message_content: {
            type: 'multimodal',
            text: 'yo',
            parts: [
              { type: 'text', text: 'yo' },
              { type: 'image', data: 'AAAA', mime_type: 'image/jpeg', source: 'porch.jpg' },
            ],
          },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages[0]?.parts).toEqual([
      { type: 'image', dataUrl: 'data:image/jpeg;base64,AAAA', name: 'porch.jpg' },
      { type: 'text', text: 'yo' },
    ]);
  });

  it('projects an image-only message as the picture rather than as "[image]" text', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({ message_role: 'user', run_message_id: 'msg_user', text: '' }),
          message_content: {
            type: 'multimodal',
            parts: [{ type: 'image', data: 'AAAA', mime_type: 'image/png', source: 'shot.png' }],
          },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages[0]?.parts).toEqual([
      { type: 'image', dataUrl: 'data:image/png;base64,AAAA', name: 'shot.png' },
    ]);
  });

  it('projects an attached file as a chip instead of a filename in the bubble', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({ message_role: 'user', run_message_id: 'msg_user', text: 'yo' }),
          message_content: {
            type: 'multimodal',
            text: 'yo\ndeck.pdf',
            parts: [
              { type: 'text', text: 'yo' },
              {
                type: 'file',
                file_id: 'art_1',
                name: 'deck.pdf',
                mime_type: 'application/pdf',
              },
            ],
          },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages[0]?.parts).toEqual([
      { type: 'file', fileId: 'art_1', name: 'deck.pdf', mimeType: 'application/pdf' },
      { type: 'text', text: 'yo' },
    ]);
  });

  it('projects a pasted image as the thumbnail alone, without a chip for its sandbox path', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({ message_role: 'user', run_message_id: 'msg_user', text: 'yo' }),
          message_content: {
            type: 'multimodal',
            text: 'yo\nporch.jpg',
            parts: [
              { type: 'text', text: 'yo' },
              { type: 'image', data: 'AAAA', mime_type: 'image/jpeg', source: 'porch.jpg' },
              {
                type: 'file',
                name: 'porch.jpg',
                mime_type: 'image/jpeg',
                path: 'tmp/attachments/inline-image-run_1-2/porch.jpg',
              },
            ],
          },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages[0]?.parts).toEqual([
      { type: 'image', dataUrl: 'data:image/jpeg;base64,AAAA', name: 'porch.jpg' },
      { type: 'text', text: 'yo' },
    ]);
  });

  it('projects a file-only message as the chip alone', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({ message_role: 'user', run_message_id: 'msg_user', text: '' }),
          message_content: {
            type: 'multimodal',
            text: 'deck.pdf',
            parts: [
              { type: 'file', file_id: 'art_1', name: 'deck.pdf', mime_type: 'application/pdf' },
            ],
          },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages[0]?.parts).toEqual([
      { type: 'file', fileId: 'art_1', name: 'deck.pdf', mimeType: 'application/pdf' },
    ]);
  });

  it('marks an inline text attachment as having no stored bytes', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({ message_role: 'user', run_message_id: 'msg_user', text: '' }),
          message_content: {
            type: 'multimodal',
            parts: [
              { type: 'file', name: 'notes.md', mime_type: 'text/markdown', text: '# notes' },
            ],
          },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages[0]?.parts).toEqual([
      { type: 'file', name: 'notes.md', mimeType: 'text/markdown', isInlineText: true },
    ]);
  });

  it('projects each Slack employee from existing source actor metadata', () => {
    const otto = create_external_source_actor({
      provider_key: 'slack',
      external_account_id: 'T123',
      external_user_id: 'U123',
      profile: { real_name: 'Otto Park' },
    });
    const robin = create_external_source_actor({
      provider_key: 'slack',
      external_account_id: 'T123',
      external_user_id: 'U456',
      profile: { real_name: 'Robin Tate' },
    });
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({
            message_role: 'user',
            run_message_id: 'msg_otto',
            text: 'Can you check this?',
          }),
          source_type: 'slack',
          source_metadata: {
            source_actor: otto,
            slack: { event_ts: '1781600400.000000', user_id: 'U123' },
          },
        } as RunMessage,
        {
          ...chat_message({
            message_role: 'user',
            run_message_id: 'msg_robin',
            text: 'And this one?',
          }),
          source_type: 'slack',
          source_metadata: { slack: { user_id: 'U456' } },
        } as RunMessage,
      ],
      source_actors: [robin],
      tool_calls: [],
    });

    expect(messages).toMatchObject([
      {
        id: 'msg_otto',
        sender: { source_actor_id: 'slack:T123:U123', display_name: 'Otto Park' },
        sent_time: '2026-06-16T09:00:00.000Z',
      },
      {
        id: 'msg_robin',
        sender: { source_actor_id: 'slack:T123:U456', display_name: 'Robin Tate' },
        sent_time: '2026-06-16T00:00:00.000Z',
      },
    ]);
  });

  it('names and dates the only speaker in the chat', () => {
    const robin = create_platform_source_actor({
      platform_user_id: 'user_2',
      profile: { display_name: 'Robin Tate' },
    });
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({
            message_role: 'user',
            run_message_id: 'msg_alone',
            text: 'yooo',
          }),
          source_metadata: { source_actor: robin },
        } as RunMessage,
      ],
      source_actors: [robin],
      tool_calls: [],
    });

    expect(messages[0]?.sender).toMatchObject({ display_name: 'Robin Tate' });
    expect(messages[0]?.sent_time).toBeTruthy();
  });

  it('names both people once a second person joins a web chat', () => {
    const robin = create_platform_source_actor({
      platform_user_id: 'user_2',
      profile: { display_name: 'Robin Tate' },
    });
    const hugo = create_platform_source_actor({
      platform_user_id: 'user_9',
      profile: { display_name: 'Hugo Martin' },
    });
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({
            message_role: 'user',
            run_message_id: 'msg_hugo',
            text: 'draft the promo',
          }),
          source_metadata: { source_actor: hugo },
        } as RunMessage,
        {
          ...chat_message({
            message_role: 'user',
            run_message_id: 'msg_robin',
            text: 'drop the third one',
          }),
          source_metadata: { source_actor: robin },
        } as RunMessage,
      ],
      source_actors: [robin, hugo],
      tool_calls: [],
    });

    expect(messages).toMatchObject([
      { id: 'msg_hugo', sender: { display_name: 'Hugo Martin' } },
      { id: 'msg_robin', sender: { display_name: 'Robin Tate' } },
    ]);
  });

  it('projects streaming assistant text into one assistant message', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_delta_streaming', {
        delta_type: 'text_delta',
        text: 'I am checking Gmail.',
      }),
    );

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      tool_calls: [],
    });

    expect(messages).toEqual([
      {
        id: 'run_1:assistant:0',
        role: 'assistant',
        run_id: 'run_1',
        parts: [{ type: 'text', text: 'I am checking Gmail.' }],
      },
    ]);
  });

  it('keeps initial assistant text chunks together after earlier thinking', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, thinking_item_started_event());
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_initial_text_1', {
        delta_type: 'text_delta',
        text: 'Okay',
      }),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_initial_text_2', {
        delta_type: 'text_delta',
        text: ", I'm on it.",
      }),
    );

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      thinking_items: chat_thread_thinking_items(projection),
      tool_calls: [],
    });

    expect(messages).toEqual([
      {
        id: 'run_1:assistant:0',
        role: 'assistant',
        run_id: 'run_1',
        parts: [{ type: 'text', text: "Okay, I'm on it." }],
      },
    ]);
  });

  it('keeps assistant text in one message across in-flight snapshot updates', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_snapshot_delta_1', { delta_type: 'text_delta', text: 'Hel' }),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      assistant_snapshot_event('evt_snapshot_1', 'Hel'),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_snapshot_delta_2', { delta_type: 'text_delta', text: 'lo' }),
    );

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      tool_calls: [],
    });

    expect(messages).toEqual([
      {
        id: 'run_1:assistant:0',
        role: 'assistant',
        run_id: 'run_1',
        parts: [{ type: 'text', text: 'Hello' }],
      },
    ]);
  });

  it('projects reasoning as an assistant reasoning part', () => {
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_thinking_complete_projected', 'item_completed', 1),
      item: {
        item_id: 'run_1:thinking:0',
        run_id: 'run_1',
        item_type: 'thinking',
        item_status: 'complete',
        item_sequence: 1,
        text: 'Plan the Gmail query.',
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      thinking_items: chat_thread_thinking_items(projection),
      tool_calls: [],
    });

    expect(messages).toEqual([
      {
        id: 'run_1:live:1',
        role: 'assistant',
        run_id: 'run_1',
        parts: [{ type: 'reasoning', text: 'Plan the Gmail query.', state: 'complete' }],
      },
    ]);
  });

  it('projects hidden assistant thinking rows as reasoning', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({
            is_user_visible: false,
            message_role: 'assistant',
            run_message_id: 'msg_reasoning',
            text: 'Searching Gmail.',
          }),
          message_content: {
            type: 'reasoning_summary',
            text: 'Searching Gmail.',
            parts: [{ type: 'thinking', thinking: 'Searching Gmail.' }],
          },
          message_kind: 'reasoning_summary',
          source_metadata: { has_visible_text: false, visibility: 'debug_trace' },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages).toEqual([
      {
        id: 'run_1:internal:1',
        role: 'assistant',
        run_id: 'run_1',
        parts: [{ type: 'reasoning', text: 'Searching Gmail.', state: 'complete' }],
      },
    ]);
  });

  it('does not project hidden plain assistant text as reasoning', () => {
    const messages = create_projected_chat_messages({
      messages: [
        {
          ...chat_message({
            is_user_visible: false,
            message_role: 'assistant',
            run_message_id: 'msg_hidden_text',
            text: 'This is not a reasoning packet.',
          }),
          message_content: {
            type: 'text',
            text: 'This is not a reasoning packet.',
            parts: [{ type: 'text', text: 'This is not a reasoning packet.' }],
          },
          source_metadata: { has_visible_text: false },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    expect(messages).toEqual([]);
  });

  it('attaches a tool call to its parent assistant message', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_parent_text', {
        delta_type: 'text_delta',
        text: "I'll check Gmail.",
      }),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      tool_item_started_event({
        item_sequence: 2,
        parent_item_id: 'run_1:assistant:0',
        tool_call_id: 'tool_call_1',
      }),
    );

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      tool_calls: chat_thread_tool_calls(projection),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'run_1:assistant:0',
      parts: [
        { type: 'text', text: "I'll check Gmail." },
        {
          type: 'tool-gmail-find_email',
          toolCallId: 'tool_call_1',
          toolName: 'gmail-find_email',
        },
      ],
    });
  });

  it('starts a new text block when text resumes after internal work', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_text_before_tool', {
        delta_type: 'text_delta',
        text: 'I will check Gmail.',
      }),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      tool_item_started_event({
        item_sequence: 3,
        parent_item_id: 'run_1:assistant:0',
        tool_call_id: 'tool_call_1',
      }),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_text_after_tool', {
        delta_type: 'text_delta',
        text: 'I found the thread.',
      }),
    );

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      tool_calls: chat_thread_tool_calls(projection),
    });

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'run_1:assistant:0',
        parts: [
          { type: 'text', text: 'I will check Gmail.' },
          expect.objectContaining({
            type: 'tool-gmail-find_email',
            toolCallId: 'tool_call_1',
          }),
          { type: 'text', text: 'I found the thread.' },
        ],
      }),
    ]);
  });

  it('segments repeated assistant item ids when persisted messages differ', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_message_1', 'item_completed', 1),
      item: {
        item_id: 'run_1:assistant:0',
        message_id: 'msg_1',
        run_id: 'run_1',
        item_type: 'assistant_message',
        item_status: 'complete',
        item_sequence: 1,
        parts: [{ type: 'text', text: "I'll search Gmail first." }],
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);
    projection = apply_chat_stream_event_to_thread(
      projection,
      tool_item_started_event({
        item_sequence: 2,
        parent_item_id: 'run_1:assistant:0',
        tool_call_id: 'tool_call_1',
      }),
    );
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_message_2', 'item_completed', 3),
      item: {
        item_id: 'run_1:assistant:0',
        message_id: 'msg_2',
        run_id: 'run_1',
        item_type: 'assistant_message',
        item_status: 'complete',
        item_sequence: 3,
        parts: [{ type: 'text', text: 'I found the likely thread.' }],
        created_time: '2026-06-16T00:00:02.000Z',
        last_updated_time: '2026-06-16T00:00:02.000Z',
      },
    } as unknown as ChatStreamEvent);

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      tool_calls: chat_thread_tool_calls(projection),
    });

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'run_1:assistant:0',
        parts: [
          { type: 'text', text: "I'll search Gmail first." },
          expect.objectContaining({
            type: 'tool-gmail-find_email',
            toolCallId: 'tool_call_1',
          }),
          { type: 'text', text: 'I found the likely thread.' },
        ],
      }),
    ]);
  });

  it('keeps repeated assistant starts from clearing earlier streamed text', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_text_before_tool', {
        delta_type: 'text_delta',
        text: 'I will check Gmail.',
      }),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      tool_item_started_event({
        item_sequence: 3,
        parent_item_id: 'run_1:assistant:0',
        tool_call_id: 'tool_call_1',
      }),
    );
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_repeated_start', 'item_started', 4),
      item: {
        item_id: 'run_1:assistant:0',
        run_id: 'run_1',
        item_type: 'assistant_message',
        item_status: 'streaming',
        item_sequence: 4,
        parts: [{ type: 'text', text: '' }],
        created_time: '2026-06-16T00:00:02.000Z',
        last_updated_time: '2026-06-16T00:00:02.000Z',
      },
    } as unknown as ChatStreamEvent);
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_text_after_repeated_start', {
        delta_type: 'text_delta',
        text: 'I found the thread.',
      }),
    );

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      tool_calls: chat_thread_tool_calls(projection),
    });

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'run_1:assistant:0',
        parts: [
          { type: 'text', text: 'I will check Gmail.' },
          expect.objectContaining({
            type: 'tool-gmail-find_email',
            toolCallId: 'tool_call_1',
          }),
          { type: 'text', text: 'I found the thread.' },
        ],
      }),
    ]);
  });

  it('updates a completed tool call without duplicating its part', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      tool_item_started_event({
        item_sequence: 2,
        parent_item_id: 'run_1:assistant:0',
        tool_call_id: 'tool_call_1',
      }),
    );
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_tool_completed', 'item_completed', 3),
      item: {
        item_id: 'run_1:tool:tool_call_1',
        run_id: 'run_1',
        item_type: 'tool_call',
        item_status: 'complete',
        item_sequence: 2,
        parent_item_id: 'run_1:assistant:0',
        tool_call_id: 'tool_call_1',
        tool_name: 'gmail-find_email',
        tool_status: 'completed',
        input_data: { q: 'is:unread' },
        output_text: 'Found one message.',
        file_ids: [],
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:01.000Z',
      },
    } as unknown as ChatStreamEvent);

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: chat_thread_assistant_message_items(projection),
      messages: [],
      tool_calls: chat_thread_tool_calls(projection),
    });
    const tool_parts = messages.flatMap((message) =>
      message.parts.filter((part) => part.type.startsWith('tool-')),
    );

    expect(tool_parts).toEqual([
      expect.objectContaining({
        output: 'Found one message.',
        state: 'completed',
        toolCallId: 'tool_call_1',
      }),
    ]);
  });

  it('projects failed tools with error text', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(
      projection,
      tool_item_started_event({
        item_sequence: 1,
        tool_call_id: 'tool_call_1',
      }),
    );
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_tool_failed', 'item_failed', 2),
      item_id: 'run_1:tool:tool_call_1',
      error: { code: 'tool_error', message: 'Gmail denied the request.' },
    } as unknown as ChatStreamEvent);

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      tool_calls: chat_thread_tool_calls(projection),
    });

    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        errorText: 'Gmail denied the request.',
        state: 'failed',
        toolCallId: 'tool_call_1',
      }),
    ]);
  });

  it('uses optional display metadata when tool input provides it', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      tool_calls: [
        {
          input_data: {
            app_name: 'gmail',
            app_display_name: 'Gmail',
            node_display_name: 'Find email',
            q: 'is:unread',
            node_key: 'gmail-find_email-1',
          },
          item_sequence: 1,
          run_id: 'run_1',
          tool_call_id: 'tool_call_1',
          tool_name: 'gmail-find_email-1',
          tool_status: 'running',
        },
      ],
    });

    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        display: { appName: 'gmail', title: 'Find email', subtitle: 'Gmail' },
        toolCallId: 'tool_call_1',
      }),
    ]);
  });

  it('uses a clean fallback title without the tool version suffix', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      tool_calls: [
        {
          input_data: {},
          item_sequence: 1,
          run_id: 'run_1',
          tool_call_id: 'tool_call_1',
          tool_name: 'browser-open_page-12',
          tool_status: 'running',
        },
      ],
    });

    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        display: { title: 'Browser Open Page' },
        toolCallId: 'tool_call_1',
      }),
    ]);
  });

  it('uses the catalog node display name as the tool title', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      catalog_nodes: [
        {
          app_id: 'app_attio',
          app_key: 'attio',
          node_display_name: 'Create or Update Record',
          node_key: 'attio-create_update_record-1',
        } as CatalogNode,
      ],
      messages: [],
      tool_calls: [
        {
          input_data: { node_key: 'attio-create_update_record-1' },
          item_sequence: 1,
          run_id: 'run_1',
          tool_call_id: 'tool_call_1',
          tool_name: 'runtime-execute_tool-1',
          tool_status: 'failed',
        },
      ],
    });

    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        display: {
          appId: 'app_attio',
          appName: 'attio',
          subtitle: 'Attio',
          title: 'Create or Update Record',
        },
        toolCallId: 'tool_call_1',
      }),
    ]);
  });

  it('joins a new live tool with the preceding tool group from the same run', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [
        assistant_tool_request_message({
          request_ids: ['call_first'],
          run_message_id: 'msg_assistant',
          sequence: 1,
          text: 'Starting the work.',
        }),
      ],
      tool_calls: [
        tool_call_with_model_id({
          item_sequence: 1,
          model_tool_call_id: 'call_first',
          tool_call_id: 'tool_first',
          tool_name: 'runtime-execute_tool-1',
        }),
        tool_call_with_model_id({
          item_sequence: 2,
          model_tool_call_id: 'call_second',
          tool_call_id: 'tool_second',
          tool_name: 'runtime-execute_tool-1',
        }),
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([
      { type: 'text', text: 'Starting the work.' },
      expect.objectContaining({ toolCallId: 'tool_first' }),
      expect.objectContaining({ toolCallId: 'tool_second' }),
    ]);
  });

  it('places a newly live tool after older persisted actions from the active run', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Run the actions.',
        }),
        chat_message({
          message_role: 'assistant',
          run_message_id: 'msg_assistant',
          sequence: 2,
          text: 'Starting the work.',
        }),
        tool_result_message({ sequence: 3, tool_call_id: 'tool_persisted' }),
      ],
      tool_calls: [
        tool_call({ item_sequence: 2, tool_call_id: 'tool_persisted' }),
        tool_call({ item_sequence: 4, tool_call_id: 'tool_new_live' }),
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts).toEqual([
      { type: 'text', text: 'Starting the work.' },
      expect.objectContaining({ toolCallId: 'tool_persisted' }),
      expect.objectContaining({ toolCallId: 'tool_new_live' }),
    ]);
  });

  it('keeps an unsequenced current tool after an intervening live thought', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      thinking_items: [
        {
          item_id: 'run_1:thinking:0',
          item_sequence: 2,
          item_status: 'complete',
          item_type: 'thinking',
          run_id: 'run_1',
          text: 'Deciding what to do next.',
        },
      ],
      tool_calls: [
        tool_call({ item_sequence: 1, tool_call_id: 'tool_first' }),
        {
          ...tool_call({ item_sequence: 3, tool_call_id: 'tool_unsequenced' }),
          created_time: '2026-06-16T00:00:03.000Z',
          item_sequence: undefined,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({ toolCallId: 'tool_first' }),
      {
        type: 'reasoning',
        text: 'Deciding what to do next.',
        state: 'complete',
      },
      expect.objectContaining({ toolCallId: 'tool_unsequenced' }),
    ]);
  });

  it('keeps live requested tools after persisted assistant text while streaming', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Which tools and connections are available?',
        }),
        assistant_tool_request_message({
          request_ids: ['call_search_tools', 'call_list_connections'],
          run_message_id: 'msg_ack',
          sequence: 2,
          text: "Okay, I'm on it. I think this will take about a minute.",
        }),
      ],
      tool_calls: [
        tool_call_with_model_id({
          item_sequence: 1,
          model_tool_call_id: 'call_search_tools',
          tool_call_id: 'tcall_search_tools',
          tool_name: 'runtime-search_tools-1',
        }),
        tool_call_with_model_id({
          item_sequence: 2,
          model_tool_call_id: 'call_list_connections',
          tool_call_id: 'tcall_list_connections',
          tool_name: 'runtime-list_connections-1',
        }),
      ],
    });

    expect(messages).toEqual([
      {
        id: 'msg_user',
        role: 'user',
        parts: [{ type: 'text', text: 'Which tools and connections are available?' }],
        sent_time: '2026-06-16T00:00:00.000Z',
      },
      {
        id: 'msg_ack',
        role: 'assistant',
        run_id: 'run_1',
        sent_time: '2026-06-16T00:00:00.000Z',
        parts: [
          { type: 'text', text: "Okay, I'm on it. I think this will take about a minute." },
          expect.objectContaining({
            type: 'tool-runtime-search_tools-1',
            toolCallId: 'tcall_search_tools',
          }),
          expect.objectContaining({
            type: 'tool-runtime-list_connections-1',
            toolCallId: 'tcall_list_connections',
          }),
        ],
      },
    ]);
  });

  it('keeps requested tools on the canonical persisted block after live replay', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: [
        assistant_item({
          item_id: 'run_1:assistant:0',
          item_sequence: 1,
          text: "Okay, I'm on it.",
        }),
      ],
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Which tools are available?',
        }),
        assistant_tool_request_message({
          request_ids: ['call_search_tools'],
          run_message_id: 'msg_ack',
          sequence: 2,
          text: "Okay, I'm on it.",
        }),
      ],
      tool_calls: [
        tool_call_with_model_id({
          item_sequence: 2,
          model_tool_call_id: 'call_search_tools',
          tool_call_id: 'tcall_search_tools',
          tool_name: 'runtime-search_tools-1',
        }),
      ],
    });

    expect(messages).toEqual([
      {
        id: 'msg_user',
        role: 'user',
        parts: [{ type: 'text', text: 'Which tools are available?' }],
        sent_time: '2026-06-16T00:00:00.000Z',
      },
      {
        id: 'msg_ack',
        role: 'assistant',
        run_id: 'run_1',
        sent_time: '2026-06-16T00:00:00.000Z',
        parts: [
          { type: 'text', text: "Okay, I'm on it." },
          expect.objectContaining({
            type: 'tool-runtime-search_tools-1',
            toolCallId: 'tcall_search_tools',
          }),
        ],
      },
    ]);
  });

  it('keeps tool-call cards on a run that is no longer the latest, given session-wide tool calls', () => {
    const messages = [
      chat_message({
        message_role: 'user',
        run_id: 'run_1',
        run_message_id: 'msg_old_user',
        sequence: 1,
        text: 'Browse example.com',
      }),
      assistant_tool_request_message({
        request_ids: ['call_browser_1'],
        run_message_id: 'msg_old_ack',
        sequence: 2,
        text: 'Opening the site.',
      }),
      chat_message({
        message_role: 'user',
        run_id: 'run_2',
        run_message_id: 'msg_new_user',
        sequence: 3,
        text: 'Now summarize it',
      }),
    ];
    const session_tool_calls = [
      {
        ...tool_call_with_model_id({
          item_sequence: 1,
          model_tool_call_id: 'call_browser_1',
          tool_call_id: 'tcall_browser_1',
          tool_name: 'browser',
        }),
        tool_status: 'completed',
      },
    ];

    const with_latest_run_detail_only = create_projected_chat_messages({
      active_run_id: 'run_2',
      messages,
      tool_calls: session_tool_calls.filter((tool_call) => tool_call.run_id === 'run_2'),
    });
    expect(
      with_latest_run_detail_only.flatMap((message) =>
        message.parts.filter((part) => part.type.startsWith('tool-')),
      ),
    ).toEqual([]);

    const with_session_wide_detail = create_projected_chat_messages({
      active_run_id: 'run_2',
      messages,
      tool_calls: session_tool_calls,
    });
    expect(with_session_wide_detail).toEqual([
      expect.objectContaining({ id: 'msg_old_user' }),
      expect.objectContaining({
        id: 'msg_old_ack',
        parts: [
          { type: 'text', text: 'Opening the site.' },
          expect.objectContaining({
            type: 'tool-browser',
            toolCallId: 'tcall_browser_1',
            state: 'completed',
          }),
        ],
      }),
      expect.objectContaining({ id: 'msg_new_user' }),
    ]);
  });

  it('does not sort active run reasoning against old session messages', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_2',
      assistant_message_items: [
        assistant_item({
          item_id: 'run_2:assistant:0',
          item_sequence: 7,
          run_id: 'run_2',
          text: "Okay, I'm on it.",
        }),
      ],
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_old_user',
          run_id: 'run_1',
          sequence: 1,
          text: "what's nora quill",
        }),
        chat_message({
          message_role: 'assistant',
          run_message_id: 'msg_old_answer',
          run_id: 'run_1',
          sequence: 2,
          text: 'Do you mean who Nora Quill is?',
        }),
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_active_user',
          run_id: 'run_2',
          sequence: 9,
          text: 'use email',
        }),
      ],
      thinking_items: [
        {
          item_id: 'run_2:thinking:0',
          item_sequence: 4,
          item_status: 'complete',
          item_type: 'thinking',
          run_id: 'run_2',
          text: 'Exploring email tools.',
        },
      ],
      tool_calls: [],
    });

    expect(messages.map((message) => message.id)).toEqual([
      'msg_old_user',
      'msg_old_answer',
      'msg_active_user',
      'run_2:live:4',
    ]);
    expect(messages[3]).toMatchObject({
      parts: [
        { type: 'reasoning', text: 'Exploring email tools.', state: 'complete' },
        { type: 'text', text: "Okay, I'm on it." },
      ],
    });
  });

  it('keeps persisted assistant text when active run only has live reasoning', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_2',
      messages: [
        chat_message({
          message_role: 'user',
          run_id: 'run_1',
          run_message_id: 'msg_old_user',
          sequence: 1,
          text: "what's nora quill",
        }),
        chat_message({
          message_role: 'user',
          run_id: 'run_2',
          run_message_id: 'msg_active_user',
          sequence: 2,
          text: 'Which tools do you have for emails',
        }),
        {
          ...chat_message({
            message_role: 'assistant',
            run_id: 'run_2',
            run_message_id: 'msg_active_answer',
            sequence: 3,
            text: "Okay, I'm on it.",
          }),
          created_time: '2026-06-16T00:00:02.000Z',
        } as RunMessage,
      ],
      thinking_items: [
        {
          item_id: 'run_2:thinking:0',
          item_sequence: 1,
          item_status: 'complete',
          item_type: 'thinking',
          run_id: 'run_2',
          text: 'Exploring email tools.',
          created_time: '2026-06-16T00:00:01.000Z',
        },
      ],
      tool_calls: [],
    });

    expect(messages).toEqual([
      expect.objectContaining({ id: 'msg_old_user' }),
      expect.objectContaining({ id: 'msg_active_user' }),
      expect.objectContaining({
        id: 'run_2:live:1',
        parts: [
          { type: 'reasoning', text: 'Exploring email tools.', state: 'complete' },
          { type: 'text', text: "Okay, I'm on it." },
        ],
      }),
    ]);
  });

  it('shows one reasoning part when live and persisted reasoning carry the same text', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Check my email.',
        }),
        {
          ...chat_message({
            is_user_visible: false,
            message_role: 'assistant',
            run_message_id: 'msg_reasoning',
            sequence: 2,
            text: 'Exploring email tools.',
          }),
          message_content: {
            type: 'reasoning_summary',
            text: 'Exploring email tools.',
            parts: [{ type: 'thinking', thinking: 'Exploring email tools.' }],
          },
          message_kind: 'reasoning_summary',
          source_metadata: { has_visible_text: false, visibility: 'debug_trace' },
        } as unknown as RunMessage,
      ],
      thinking_items: [
        {
          item_id: 'run_1:thinking:0',
          item_sequence: 2,
          item_status: 'complete',
          item_type: 'thinking',
          run_id: 'run_1',
          text: 'Exploring email tools.',
        },
      ],
      tool_calls: [],
    });

    const reasoning_parts = messages.flatMap((message) =>
      message.parts.filter((part) => part.type === 'reasoning'),
    );
    expect(reasoning_parts).toEqual([
      { type: 'reasoning', text: 'Exploring email tools.', state: 'complete' },
    ]);
  });

  it('shows saved reasoning once when the live copy splits it into parts and spaces', () => {
    const saved_reasoning = {
      ...chat_message({
        is_user_visible: false,
        message_role: 'assistant',
        run_message_id: 'msg_reasoning',
        sequence: 2,
        text: 'Google Sheets is connected.\nLooking for the right tools.',
      }),
      message_content: {
        type: 'reasoning_summary',
        text: 'Google Sheets is connected.\nLooking for the right tools.',
        parts: [
          { type: 'thinking', thinking: 'Google Sheets is connected.' },
          { type: 'thinking', thinking: 'Looking for the right tools.' },
        ],
      },
      message_kind: 'reasoning_summary',
      source_metadata: { has_visible_text: false, visibility: 'debug_trace' },
    } as unknown as RunMessage;
    const live_thinking = (index: number, text: string) => ({
      item_id: `run_1:thinking:${index}`,
      item_sequence: 2 + index,
      item_status: 'complete' as const,
      item_type: 'thinking' as const,
      run_id: 'run_1',
      text,
    });
    const project = (thinking_items: ReturnType<typeof live_thinking>[]) =>
      create_projected_chat_messages({
        active_run_id: 'run_1',
        messages: [saved_reasoning],
        thinking_items,
        tool_calls: [],
      });

    expect(
      project([
        live_thinking(0, '\nGoogle Sheets is connected. '),
        live_thinking(1, 'Looking for the right  tools.\n'),
      ]),
    ).toEqual(project([]));
  });

  it('shows saved assistant text once when the live copy ends in a newline', () => {
    const project = (assistant_message_items: ReturnType<typeof assistant_item>[]) =>
      create_projected_chat_messages({
        active_run_id: 'run_1',
        assistant_message_items,
        messages: [
          chat_message({
            message_role: 'assistant',
            run_message_id: 'msg_text',
            sequence: 2,
            text: 'Now creating the spreadsheet.',
          }),
        ],
        tool_calls: [],
      });

    expect(
      project([
        assistant_item({
          item_id: 'run_1:assistant:0',
          item_sequence: 2,
          text: 'Now creating the spreadsheet.\n\n',
        }),
      ]),
    ).toEqual(project([]));
  });

  it('keeps persisted block order unchanged when completed replay items arrive', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Do the work.',
        }),
        {
          ...chat_message({
            is_user_visible: false,
            message_role: 'assistant',
            run_message_id: 'msg_reasoning',
            sequence: 2,
            text: 'Checking the final records.',
          }),
          message_content: {
            type: 'reasoning_summary',
            text: 'Checking the final records.',
            parts: [{ type: 'thinking', thinking: 'Checking the final records.' }],
          },
          message_kind: 'reasoning_summary',
          source_metadata: { has_visible_text: false, visibility: 'debug_trace' },
        } as unknown as RunMessage,
        tool_result_message({ sequence: 3, tool_call_id: 'tool_persisted' }),
        chat_message({
          message_role: 'assistant',
          run_message_id: 'msg_final',
          sequence: 4,
          text: 'Everything is complete.',
        }),
      ],
      thinking_items: [
        {
          created_time: '2026-06-16T00:00:01.000Z',
          duration_ms: 144_000,
          item_id: 'run_1:thinking:late_replay',
          item_sequence: 433,
          item_status: 'complete',
          item_type: 'thinking',
          run_id: 'run_1',
          text: 'Checking the final records.',
        },
      ],
      tool_calls: [tool_call({ item_sequence: 430, tool_call_id: 'tool_persisted' })],
    });

    expect(messages.slice(1).flatMap((message) => message.parts)).toEqual([
      { type: 'reasoning', text: 'Checking the final records.', state: 'complete' },
      expect.objectContaining({ toolCallId: 'tool_persisted' }),
      { type: 'text', text: 'Everything is complete.' },
    ]);
  });

  it('keeps persisted reasoning on a completed run with no active run', () => {
    const messages = create_projected_chat_messages({
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Check my email.',
        }),
        {
          ...chat_message({
            is_user_visible: false,
            message_role: 'assistant',
            run_message_id: 'msg_reasoning',
            sequence: 2,
            text: 'Exploring email tools.',
          }),
          message_content: {
            type: 'reasoning_summary',
            text: 'Exploring email tools.',
            parts: [{ type: 'thinking', thinking: 'Exploring email tools.' }],
          },
          message_kind: 'reasoning_summary',
          source_metadata: { has_visible_text: false, visibility: 'debug_trace' },
        } as unknown as RunMessage,
      ],
      tool_calls: [],
    });

    const reasoning_parts = messages.flatMap((message) =>
      message.parts.filter((part) => part.type === 'reasoning'),
    );
    expect(reasoning_parts).toEqual([
      { type: 'reasoning', text: 'Exploring email tools.', state: 'complete' },
    ]);
  });

  it('projects persisted tool results and hidden reasoning before the final answer', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Check unread LinkedIn emails.',
        }),
        chat_message({
          message_role: 'assistant',
          run_message_id: 'msg_ack',
          sequence: 2,
          text: 'I will check Gmail.',
        }),
        tool_result_message({ sequence: 3, tool_call_id: 'tool_call_1' }),
        {
          ...chat_message({
            is_user_visible: false,
            message_role: 'assistant',
            run_message_id: 'msg_reasoning',
            sequence: 4,
            text: 'Refining the Gmail search.',
          }),
          message_content: {
            type: 'reasoning_summary',
            text: 'Refining the Gmail search.',
            parts: [{ type: 'thinking', thinking: 'Refining the Gmail search.' }],
          },
          message_kind: 'reasoning_summary',
          source_metadata: { has_visible_text: false, visibility: 'debug_trace' },
        } as unknown as RunMessage,
        tool_result_message({ sequence: 5, tool_call_id: 'tool_call_2' }),
        chat_message({
          message_role: 'assistant',
          run_message_id: 'msg_done',
          sequence: 6,
          text: 'Done. No LinkedIn emails need a reply.',
        }),
      ],
      tool_calls: [
        tool_call({ item_sequence: 10, tool_call_id: 'tool_call_1' }),
        tool_call({ item_sequence: 20, tool_call_id: 'tool_call_2' }),
      ],
    });

    expect(messages).toEqual([
      {
        id: 'msg_user',
        role: 'user',
        parts: [{ type: 'text', text: 'Check unread LinkedIn emails.' }],
        sent_time: '2026-06-16T00:00:00.000Z',
      },
      {
        id: 'msg_ack',
        role: 'assistant',
        run_id: 'run_1',
        sent_time: '2026-06-16T00:00:00.000Z',
        parts: [
          { type: 'text', text: 'I will check Gmail.' },
          expect.objectContaining({
            type: 'tool-gmail-find_email',
            toolCallId: 'tool_call_1',
          }),
          { type: 'reasoning', text: 'Refining the Gmail search.', state: 'complete' },
          expect.objectContaining({
            type: 'tool-gmail-find_email',
            toolCallId: 'tool_call_2',
          }),
          { type: 'text', text: 'Done. No LinkedIn emails need a reply.' },
        ],
      },
    ]);
  });

  it('keeps active run live timeline order after persisted rows refetch', () => {
    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      assistant_message_items: [
        assistant_item({
          item_id: 'run_1:assistant:0',
          item_sequence: 1,
          text: "Okay, I'm on it. I think this will take about 10 minutes.",
        }),
        assistant_item({
          item_id: 'run_1:assistant:1',
          item_sequence: 4,
          text: 'I only see Slack connected, so I need the lead list or source.',
        }),
      ],
      messages: [
        chat_message({
          message_role: 'user',
          run_message_id: 'msg_user',
          sequence: 1,
          text: 'Follow up with leads',
        }),
        {
          ...chat_message({
            message_role: 'assistant',
            run_message_id: 'msg_ack',
            sequence: 2,
            text: "Okay, I'm on it. I think this will take about 10 minutes.",
          }),
          created_time: '2026-06-16T00:00:02.000Z',
        } as RunMessage,
        {
          ...tool_result_message({ sequence: 3, tool_call_id: 'tool_call_1' }),
          created_time: '2026-06-16T00:00:02.500Z',
          last_updated_time: '2026-06-16T00:00:02.500Z',
        } as RunMessage,
        {
          ...chat_message({
            message_role: 'assistant',
            run_message_id: 'msg_done',
            sequence: 4,
            text: 'I only see Slack connected, so I need the lead list or source.',
          }),
          created_time: '2026-06-16T00:00:04.000Z',
        } as RunMessage,
      ],
      tool_calls: [
        tool_call({ item_sequence: 2, tool_call_id: 'tool_call_1' }),
        {
          ...tool_call({ item_sequence: 3, tool_call_id: 'provider_only_tool_call' }),
          created_time: '2026-06-16T00:00:03.000Z',
        },
      ],
    });

    expect(messages[0]).toEqual({
      id: 'msg_user',
      role: 'user',
      parts: [{ type: 'text', text: 'Follow up with leads' }],
      sent_time: '2026-06-16T00:00:00.000Z',
    });
    expect(messages.slice(1).flatMap((message) => message.parts)).toEqual([
      {
        type: 'text',
        text: "Okay, I'm on it. I think this will take about 10 minutes.",
      },
      expect.objectContaining({
        type: 'tool-gmail-find_email',
        toolCallId: 'tool_call_1',
      }),
      expect.objectContaining({
        type: 'tool-gmail-find_email',
        toolCallId: 'provider_only_tool_call',
      }),
      {
        type: 'text',
        text: 'I only see Slack connected, so I need the lead list or source.',
      },
    ]);
  });

  it('applies assistant text deltas from chat events', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_delta_1', {
        delta_type: 'text_delta',
        text: 'Checked ',
      }),
    );
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_delta_2', {
        delta_type: 'text_delta',
        text: 'the account list.',
      }),
    );

    expect(chat_thread_streaming_text(projection)).toBe('Checked the account list.');
  });

  it('tracks the latest applied sequence for incremental replay', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_delta_10', {
        delta_type: 'text_delta',
        text: 'Checked ',
      }),
    );

    expect(projection.last_sequence).toBe(2);
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_delta_older', 'item_delta', 1),
      item_id: 'run_1:assistant:0',
      delta: { delta_type: 'text_delta', text: 'ignored order for sequence max' },
    } as unknown as ChatStreamEvent);

    expect(projection.last_sequence).toBe(2);
  });

  it('keeps completed assistant text visible while the live run is still resolving', () => {
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_text_complete', 'item_completed', 1),
      item: {
        item_id: 'run_1:assistant:0',
        run_id: 'run_1',
        item_type: 'assistant_message',
        item_status: 'complete',
        item_sequence: 1,
        parts: [{ type: 'text', text: 'I created the document.' }],
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_streaming_text(projection)).toBe('I created the document.');
  });

  it('keeps the assistant start sequence when a later completion arrives', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, chat_item_started_event());
    projection = apply_chat_stream_event_to_thread(
      projection,
      chat_item_delta_event('evt_delta_before_tool', {
        delta_type: 'text_delta',
        text: 'I will check.',
      }),
    );
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_text_complete_after_tool', 'item_completed', 30),
      item: {
        item_id: 'run_1:assistant:0',
        run_id: 'run_1',
        item_type: 'assistant_message',
        item_status: 'complete',
        item_sequence: 30,
        parts: [{ type: 'text', text: 'Done.' }],
        created_time: '2026-06-16T00:00:02.000Z',
        last_updated_time: '2026-06-16T00:00:02.000Z',
      },
    } as unknown as ChatStreamEvent);

    expect(projection.items).toEqual([
      expect.objectContaining({
        item_id: 'run_1:assistant:0',
        item_sequence: 1,
        item_status: 'complete',
      }),
    ]);
  });

  it('creates visible thinking from a delta even when start was missed', () => {
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_thinking_delta', 'item_delta', 1),
      item_id: 'run_1:thinking:0',
      delta: {
        delta_type: 'thinking_delta',
        text: 'Inspecting the request.',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_streaming_thinking(projection)).toBe('Inspecting the request.');
  });

  it('keeps an empty active thinking item visible', () => {
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_thinking_start', 'item_started', 1),
      item: {
        item_id: 'run_1:thinking:0',
        run_id: 'run_1',
        item_type: 'thinking',
        item_status: 'streaming',
        item_sequence: 1,
        text: '',
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_streaming_thinking(projection)).toBe('');
    expect(chat_thread_thinking_activity(projection)).toEqual({
      is_active: true,
      item_id: 'run_1:thinking:0',
      run_id: 'run_1',
      text: '',
    });
  });

  it('keeps completed thinking visible for history', () => {
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_thinking_complete', 'item_completed', 1),
      item: {
        item_id: 'run_1:thinking:0',
        run_id: 'run_1',
        item_type: 'thinking',
        item_status: 'complete',
        item_sequence: 1,
        text: 'Checked the inbox query before calling Gmail.',
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_thinking_items(projection)).toEqual([
      expect.objectContaining({
        item_status: 'complete',
        text: 'Checked the inbox query before calling Gmail.',
      }),
    ]);
    expect(chat_thread_thinking_activity(projection)).toEqual({
      is_active: false,
      item_id: 'run_1:thinking:0',
      run_id: 'run_1',
      text: 'Checked the inbox query before calling Gmail.',
    });
  });

  it('preserves accumulated thinking when the completion item has no text', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_thinking_start', 'item_started', 1),
      item: {
        item_id: 'run_1:thinking:0',
        run_id: 'run_1',
        item_type: 'thinking',
        item_status: 'streaming',
        item_sequence: 1,
        text: '',
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_thinking_delta_1', 'item_delta', 2),
      item_id: 'run_1:thinking:0',
      delta: {
        delta_type: 'thinking_delta',
        text: 'Inspecting ',
      },
    } as unknown as ChatStreamEvent);
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_thinking_delta_2', 'item_delta', 3),
      item_id: 'run_1:thinking:0',
      delta: {
        delta_type: 'thinking_delta',
        text: 'the Gmail query.',
      },
    } as unknown as ChatStreamEvent);
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_thinking_complete_empty', 'item_completed', 4),
      item: {
        item_id: 'run_1:thinking:0',
        run_id: 'run_1',
        item_type: 'thinking',
        item_status: 'complete',
        item_sequence: 4,
        text: '',
        created_time: '2026-06-16T00:00:01.000Z',
        last_updated_time: '2026-06-16T00:00:01.000Z',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_thinking_items(projection)).toEqual([
      expect.objectContaining({
        item_sequence: 1,
        item_status: 'complete',
        text: 'Inspecting the Gmail query.',
      }),
    ]);
    expect(chat_thread_thinking_activity(projection)).toEqual({
      is_active: false,
      item_id: 'run_1:thinking:0',
      run_id: 'run_1',
      text: 'Inspecting the Gmail query.',
    });
  });

  it('projects chat tool items into visible tool calls', () => {
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_tool_start', 'item_started', 1),
      item: {
        item_id: 'run_1:tool:call_provider_1',
        run_id: 'run_1',
        item_type: 'tool_call',
        item_status: 'streaming',
        item_sequence: 1,
        tool_call_id: 'tcall_1',
        provider_tool_call_id: 'call_provider_1',
        tool_name: 'workspace-run_command',
        tool_status: 'executing',
        input_data: { command: 'pnpm', args: ['test'] },
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_tool_calls(projection)).toEqual([
      expect.objectContaining({
        tool_call_id: 'tcall_1',
        run_id: 'run_1',
        tool_name: 'workspace-run_command',
        tool_status: 'executing',
        input_data: { command: 'pnpm', args: ['test'] },
        tool_call_metadata: expect.objectContaining({
          runtime_tool_call_id: 'call_provider_1',
        }),
      }),
    ]);
  });

  it('projects generated UI items from chat events', () => {
    const ui_spec = {
      root: 'root',
      elements: {
        root: { type: 'Text', props: { text: 'Ready' }, children: [] },
      },
    };
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_ui_start', 'item_started', 1),
      item: {
        item_id: 'run_1:ui:0',
        run_id: 'run_1',
        item_type: 'generative_ui',
        item_status: 'streaming',
        item_sequence: 1,
        renderer_key: 'json-render',
        ui_spec,
        ui_spec_format: 'json-render',
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_generative_ui_items(projection)).toEqual([
      expect.objectContaining({
        item_id: 'run_1:ui:0',
        renderer_key: 'json-render',
        ui_spec,
        ui_spec_format: 'json-render',
      }),
    ]);
  });

  it('creates generated UI from a delta when the start event was missed', () => {
    const ui_spec_delta = {
      root: 'root',
      elements: {
        root: { type: 'Text', props: { text: 'Streaming' }, children: [] },
      },
    };
    const projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_ui_delta', 'item_delta', 1),
      item_id: 'run_1:generative_ui:0',
      delta: {
        delta_type: 'generative_ui_delta',
        ui_spec_delta,
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_generative_ui_items(projection)).toEqual([
      expect.objectContaining({
        item_id: 'run_1:generative_ui:0',
        item_status: 'streaming',
        item_type: 'generative_ui',
        renderer_key: 'json-render',
        ui_spec: ui_spec_delta,
        ui_spec_format: 'json-render',
      }),
    ]);
  });

  it('accumulates artifact content deltas from chat events', () => {
    let projection = apply_chat_stream_event_to_thread(create_empty_chat_thread_projection(), {
      ...base_chat_event('evt_artifact_start', 'item_started', 1),
      item: {
        item_id: 'run_1:artifact:doc_1',
        run_id: 'run_1',
        item_type: 'artifact',
        item_status: 'streaming',
        item_sequence: 1,
        file_id: 'doc_1',
        file_purpose: 'text',
        title: 'Silicon Valley Essay',
        content_preview: '',
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
      },
    } as unknown as ChatStreamEvent);

    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_artifact_delta_1', 'item_delta', 2),
      item_id: 'run_1:artifact:doc_1',
      delta: {
        delta_type: 'artifact_content_delta',
        file_id: 'doc_1',
        content_delta: '# Silicon Valley\n\n',
      },
    } as unknown as ChatStreamEvent);
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_artifact_delta_2', 'item_delta', 3),
      item_id: 'run_1:artifact:doc_1',
      delta: {
        delta_type: 'artifact_content_delta',
        file_id: 'doc_1',
        content_delta: 'Generated text.',
      },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_artifact_items(projection)).toEqual([
      expect.objectContaining({
        file_id: 'doc_1',
        content: '# Silicon Valley\n\nGenerated text.',
        content_preview: '# Silicon Valley\n\nGenerated text.',
        title: 'Silicon Valley Essay',
      }),
    ]);
  });

  it('merges persisted tool calls with matching live chat tool calls', () => {
    const persisted = [
      {
        tool_call_id: 'tcall_product_1',
        run_id: 'run_1',
        tool_name: 'workspace-run_command',
        tool_status: 'executing',
        input_data: { command: 'pnpm', args: ['test'] },
        tool_call_metadata: { runtime_tool_call_id: 'call_provider_1' },
      } as unknown as ToolCall,
    ];
    const live = {
      tool_call_id: 'tcall_live_1',
      run_id: 'run_1',
      tool_name: 'workspace-run_command',
      tool_status: 'completed',
      input_data: { command: 'pnpm', args: ['test'] },
      output_text: 'passed',
      tool_call_metadata: { runtime_tool_call_id: 'call_provider_1' },
    };

    const tool_calls = merge_chat_tool_calls(persisted, [live]);

    expect(tool_calls).toHaveLength(1);
    expect(tool_calls[0]).toMatchObject({
      tool_call_id: 'tcall_product_1',
      tool_status: 'completed',
      output_text: 'passed',
    });
  });

  it('keeps live stream sequence when merging persisted tool calls', () => {
    const persisted = [
      {
        tool_call_id: 'tcall_product_1',
        run_id: 'run_1',
        tool_name: 'gmail-find_email',
        tool_status: 'executing',
        input_data: { q: 'is:unread' },
        tool_call_metadata: { runtime_tool_call_id: 'call_provider_1' },
      } as unknown as ToolCall,
      {
        tool_call_id: 'tcall_product_2',
        run_id: 'run_1',
        tool_name: 'gmail-read_email',
        tool_status: 'executing',
        input_data: { id: 'msg_1' },
        tool_call_metadata: { runtime_tool_call_id: 'call_provider_2' },
      } as unknown as ToolCall,
    ];
    const live = [
      {
        item_sequence: 40,
        tool_call_id: 'tcall_live_2',
        run_id: 'run_1',
        tool_name: 'gmail-read_email',
        tool_status: 'completed',
        input_data: { id: 'msg_1' },
        output_text: 'message body',
        tool_call_metadata: { runtime_tool_call_id: 'call_provider_2' },
      },
      {
        item_sequence: 20,
        tool_call_id: 'tcall_live_1',
        run_id: 'run_1',
        tool_name: 'gmail-find_email',
        tool_status: 'completed',
        input_data: { q: 'is:unread' },
        output_text: 'found message',
        tool_call_metadata: { runtime_tool_call_id: 'call_provider_1' },
      },
    ];

    const tool_calls = merge_chat_tool_calls(persisted, live);

    expect(tool_calls.map((tool_call) => tool_call.tool_call_id)).toEqual([
      'tcall_product_1',
      'tcall_product_2',
    ]);
    expect(tool_calls.map((tool_call) => tool_call.item_sequence)).toEqual([20, 40]);
  });

  it('projects a memory recall source event as a source part on its run', () => {
    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_memory_recall', 'item_completed', 1),
      item: {
        item_id: 'run_1:memory:recall',
        run_id: 'run_1',
        item_type: 'source',
        item_status: 'complete',
        item_sequence: 0,
        created_time: '2026-06-16T00:00:00.000Z',
        last_updated_time: '2026-06-16T00:00:00.000Z',
        source: {
          source_id: 'workspace_memory_recall',
          title: 'Workspace memory',
          citation_text: '14 facts · 3 about this person',
          metadata: { fact_count: 14, about_actor_count: 3 },
        },
      },
    } as unknown as ChatStreamEvent);

    const source_items = chat_thread_source_items(projection);
    expect(source_items).toHaveLength(1);

    const messages = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      source_items,
      tool_calls: [],
    });

    expect(messages.flatMap((message) => message.parts)).toEqual([
      {
        type: 'source',
        sourceId: 'workspace_memory_recall',
        title: 'Workspace memory',
        citationText: '14 facts · 3 about this person',
      },
    ]);
  });

  it('keeps a tool output when the same item is re-announced with a null one', () => {
    const tool_item = {
      item_id: 'run_1:tool:toolu_1',
      run_id: 'run_1',
      item_type: 'tool_call',
      item_sequence: 1,
      tool_call_id: 'run_1:tool:toolu_1',
      tool_name: 'runtime-create_connection-1',
    };
    const completed_output = { data: { type: 'connection_setup', start_url: 'https://x/start' } };

    let projection = create_empty_chat_thread_projection();
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_tool_done', 'item_completed', 1),
      item: { ...tool_item, item_status: 'complete', output_data: completed_output },
    } as unknown as ChatStreamEvent);
    projection = apply_chat_stream_event_to_thread(projection, {
      ...base_chat_event('evt_tool_restart', 'item_started', 2),
      item: { ...tool_item, item_status: 'streaming', output_data: null },
    } as unknown as ChatStreamEvent);

    expect(chat_thread_tool_calls(projection)[0]?.output_data).toEqual(completed_output);
  });
});

function chat_item_started_event(): ChatStreamEvent {
  return {
    ...base_chat_event('evt_start', 'item_started', 1),
    item: {
      item_id: 'run_1:assistant:0',
      run_id: 'run_1',
      item_type: 'assistant_message',
      item_status: 'streaming',
      item_sequence: 1,
      parts: [{ type: 'text', text: '' }],
      created_time: '2026-06-16T00:00:00.000Z',
      last_updated_time: '2026-06-16T00:00:00.000Z',
    },
  } as unknown as ChatStreamEvent;
}

function assistant_item(input: {
  item_id: string;
  item_sequence: number;
  run_id?: string;
  text: string;
}): ReturnType<typeof chat_thread_assistant_message_items>[number] {
  return {
    item_id: input.item_id,
    run_id: input.run_id ?? 'run_1',
    item_type: 'assistant_message',
    item_status: 'complete',
    item_sequence: input.item_sequence,
    parts: [{ type: 'text', text: input.text }],
    created_time: '2026-06-16T00:00:00.000Z',
    last_updated_time: '2026-06-16T00:00:00.000Z',
  };
}

function thinking_item_started_event(): ChatStreamEvent {
  return {
    ...base_chat_event('evt_thinking_start', 'item_started', 1),
    item: {
      item_id: 'run_1:thinking:0',
      run_id: 'run_1',
      item_type: 'thinking',
      item_status: 'streaming',
      item_sequence: 1,
      text: '',
      created_time: '2026-06-16T00:00:00.000Z',
      last_updated_time: '2026-06-16T00:00:00.000Z',
    },
  } as unknown as ChatStreamEvent;
}

function chat_item_delta_event(
  event_id: string,
  delta: { delta_type: string; text: string },
): ChatStreamEvent {
  return {
    ...base_chat_event(event_id, 'item_delta', 2),
    item_id: 'run_1:assistant:0',
    delta,
  } as unknown as ChatStreamEvent;
}

function assistant_snapshot_event(event_id: string, text: string): ChatStreamEvent {
  return {
    ...base_chat_event(event_id, 'item_updated', 3),
    item_id: 'run_1:assistant:0',
    patch: {
      parts: [{ type: 'text', text }],
      item_status: 'streaming',
      last_updated_time: '2026-06-16T00:00:01.000Z',
    },
  } as unknown as ChatStreamEvent;
}

function tool_item_started_event(input: {
  item_sequence: number;
  parent_item_id?: string;
  tool_call_id: string;
}): ChatStreamEvent {
  return {
    ...base_chat_event(`evt_${input.tool_call_id}_started`, 'item_started', input.item_sequence),
    item: {
      item_id: `run_1:tool:${input.tool_call_id}`,
      run_id: 'run_1',
      item_type: 'tool_call',
      item_status: 'streaming',
      item_sequence: input.item_sequence,
      ...(input.parent_item_id ? { parent_item_id: input.parent_item_id } : {}),
      tool_call_id: input.tool_call_id,
      tool_name: 'gmail-find_email',
      tool_status: 'running',
      input_data: { q: 'is:unread' },
      file_ids: [],
      created_time: '2026-06-16T00:00:00.000Z',
      last_updated_time: '2026-06-16T00:00:00.000Z',
    },
  } as unknown as ChatStreamEvent;
}

function chat_message(input: {
  is_user_visible?: boolean;
  message_role: 'assistant' | 'user';
  run_id?: string;
  run_message_id: string;
  sequence?: number;
  text: string;
}): RunMessage {
  const sequence = input.sequence ?? 1;
  return {
    created_time: '2026-06-16T00:00:00.000Z',
    is_model_visible: true,
    is_user_visible: input.is_user_visible ?? true,
    last_updated_time: '2026-06-16T00:00:00.000Z',
    message_content: { text: input.text, type: 'text' },
    message_kind: input.message_role === 'user' ? 'input' : 'output',
    message_role: input.message_role,
    message_sequence: sequence,
    run_id: input.run_id ?? (input.message_role === 'assistant' ? 'run_1' : undefined),
    run_message_id: input.run_message_id,
    run_message_sequence: sequence,
    session_id: 'ses_1',
    workspace_id: 'wsp_1',
  } as unknown as RunMessage;
}

function assistant_tool_request_message(input: {
  request_ids: string[];
  run_message_id: string;
  sequence: number;
  text: string;
}): RunMessage {
  return {
    ...chat_message({
      message_role: 'assistant',
      run_message_id: input.run_message_id,
      sequence: input.sequence,
      text: input.text,
    }),
    message_content: {
      text: input.text,
      type: 'text',
      parts: [
        { type: 'text', text: input.text },
        ...input.request_ids.map((request_id) => ({
          id: request_id,
          name: 'runtime_tool',
          type: 'tool_call',
          arguments: {},
        })),
      ],
    },
  } as unknown as RunMessage;
}

function tool_result_message(input: { sequence: number; tool_call_id: string }): RunMessage {
  return {
    created_time: '2026-06-16T00:00:00.000Z',
    is_model_visible: true,
    is_user_visible: true,
    last_updated_time: '2026-06-16T00:00:00.000Z',
    message_content: {
      parts: [
        {
          type: 'tool_result',
          tool_name: 'gmail-find_email',
          result: { content_text: 'Found one email.' },
        },
      ],
    },
    message_kind: 'tool_result',
    message_role: 'tool_result',
    message_sequence: input.sequence,
    run_id: 'run_1',
    run_message_id: `msg_tool_${input.tool_call_id}`,
    run_message_sequence: input.sequence,
    session_id: 'ses_1',
    tool_call_id: input.tool_call_id,
    workspace_id: 'wsp_1',
  } as unknown as RunMessage;
}

function tool_call(input: { item_sequence: number; tool_call_id: string }): ChatToolCall {
  return {
    input_data: { q: 'is:unread' },
    item_sequence: input.item_sequence,
    run_id: 'run_1',
    tool_call_id: input.tool_call_id,
    tool_name: 'gmail-find_email',
    tool_status: 'completed',
  };
}

function tool_call_with_model_id(input: {
  item_sequence: number;
  model_tool_call_id: string;
  tool_call_id: string;
  tool_name: string;
}): ChatToolCall {
  return {
    input_data: {},
    item_sequence: input.item_sequence,
    run_id: 'run_1',
    tool_call_id: input.tool_call_id,
    tool_call_metadata: { runtime_tool_call_id: input.model_tool_call_id },
    tool_name: input.tool_name,
    tool_status: 'running',
  };
}

function base_chat_event(event_id: string, event_type: string, sequence: number) {
  return {
    type: 'chat_event',
    event_id,
    workspace_id: 'wsp_1',
    session_id: 'ses_1',
    run_id: 'run_1',
    sequence,
    event_type,
    occurred_time: '2026-06-16T00:00:00.000Z',
    source: { source_type: 'runtime_event', runtime_event_id: `raw_${event_id}` },
  };
}
