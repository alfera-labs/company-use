import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_run_message,
  create_session,
  list_run_messages,
} from '@coworker/core/db/queries/sessions';
import { build_session_context } from '@runtime-platform/orchestrator/context_builder';
import {
  record_runtime_event,
  record_runtime_message,
} from '@runtime-platform/orchestrator/event_persistence';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

describe('historical tool context', () => {
  it('replays persisted tool calls and matching results in a later run', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const first_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Find the account' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });
    await record_runtime_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      role: 'assistant',
      content: { type: 'reasoning_summary', text: 'Internal reasoning is not history.' },
      actor_id: bootstrap.user_id,
    });
    await record_runtime_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      role: 'assistant',
      content: {
        type: 'multimodal',
        parts: [
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'runtime-get_tool_schema-1',
            arguments: { node_key: 'runtime-search_tools-1' },
          },
        ],
      },
      actor_id: bootstrap.user_id,
    });
    const tools = create_runtime_tool_definitions(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const execute_get_tool_schema = tools.find(
      (tool) => tool.tool_name === 'runtime-get_tool_schema-1',
    )?.execute;
    if (!execute_get_tool_schema) throw new Error('runtime-get_tool_schema-1 was not registered');
    const result = await execute_get_tool_schema(
      { node_key: 'runtime-search_tools-1' },
      {
        run_key: first_run.run_id,
        session_key: session.session_id,
        tool_call_id: 'call_1',
        metadata: {},
      },
    );
    expect(result.ok).toBe(true);
    const persisted_messages = await list_run_messages(
      db,
      bootstrap.workspace_id,
      first_run.run_id,
    );
    const persisted_result = persisted_messages.find(
      (message) => message.message_role === 'tool_result',
    );
    expect(persisted_result?.tool_call_id).not.toBe('call_1');
    const second_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: second_run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Continue' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });

    const context = await build_session_context(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      system_instructions: 'Complete the task.',
    });

    expect(context.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool_result',
      'user',
    ]);
    expect(context.messages[1]?.content.parts).toEqual([
      {
        type: 'tool_call',
        id: 'call_1',
        name: 'runtime-get_tool_schema-1',
        arguments: { node_key: 'runtime-search_tools-1' },
      },
    ]);
    expect(context.messages[2]?.content.parts).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_call_id: 'call_1',
        tool_name: 'runtime-get_tool_schema-1',
        result: expect.objectContaining({ ok: true }),
      }),
    ]);
    expect(JSON.stringify(context.messages)).not.toContain('Internal reasoning is not history.');
  });

  it('keeps a [thinking, tool_call] turn model-visible so a resumed run reads its own call', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const first_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Find the schema' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });
    await record_runtime_event(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      event: {
        event_type: 'message',
        event_id: 'evt_reasoned_call',
        event_sequence: 1,
        run_key: first_run.run_id,
        session_key: session.session_id,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Private plan the caller must never read.' },
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'runtime-get_tool_schema-1',
              arguments: { node_key: 'runtime-search_tools-1' },
            },
          ],
        },
      },
      actor_id: bootstrap.user_id,
    });

    const first_run_messages = await list_run_messages(
      db,
      bootstrap.workspace_id,
      first_run.run_id,
    );
    const assistant_turn = first_run_messages.find(
      (message) => message.message_role === 'assistant',
    );
    expect(assistant_turn?.is_model_visible).toBe(true);
    expect(assistant_turn?.message_kind).not.toBe('reasoning_summary');
    expect(assistant_turn?.content_text ?? '').not.toContain('Private plan');

    const tools = create_runtime_tool_definitions(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: first_run.run_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const execute_get_tool_schema = tools.find(
      (tool) => tool.tool_name === 'runtime-get_tool_schema-1',
    )?.execute;
    if (!execute_get_tool_schema) throw new Error('runtime-get_tool_schema-1 was not registered');
    await execute_get_tool_schema(
      { node_key: 'runtime-search_tools-1' },
      {
        run_key: first_run.run_id,
        session_key: session.session_id,
        tool_call_id: 'call_1',
        metadata: {},
      },
    );

    const second_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await create_run_message(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      run_id: second_run.run_id,
      message_role: 'user',
      message_content: { type: 'text', text: 'Continue' },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    });

    const context = await build_session_context(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      system_instructions: 'Complete the task.',
    });

    expect(context.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool_result',
      'user',
    ]);
    const carried_call = context.messages[1]?.content.parts?.find(
      (part) => part.type === 'tool_call',
    );
    expect(carried_call).toMatchObject({ id: 'call_1', name: 'runtime-get_tool_schema-1' });
    expect(context.messages[2]?.content.parts).toEqual([
      expect.objectContaining({ type: 'tool_result', tool_call_id: 'call_1' }),
    ]);
  });
});
