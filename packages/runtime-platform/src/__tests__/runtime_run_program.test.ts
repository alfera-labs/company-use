import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_session,
  list_run_messages,
  list_run_tool_calls,
} from '@coworker/core/db/queries/sessions';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { execute_runtime_tool } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

async function create_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  return { db, actor, session, run };
}

async function run_program_tool(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  program: string,
) {
  return execute_runtime_tool(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: fixture.actor.agent_id,
    actor_id: fixture.actor.user_id,
    node_key: 'runtime-run_program-1',
    tool_input: { program },
    environment: {
      env_key: 'test',
      env_kind: 'custom',
      read: async (path: string) => (path === 'tmp/message.md' ? 'a | 1\nb | 2\nc | 3' : ''),
    } as never,
  });
}

describe('runtime-run_program-1', () => {
  it("lets a program read a file and call tools, recording each call out of the model's sight", async () => {
    const fixture = await create_fixture();
    const execution = await run_program_tool(
      fixture,
      `
        const rows = read_file('tmp/message.md').split('\\n').map((line) => line.split(' | '));
        const schemas = rows.map(() => call_tool('runtime-get_tool_schema-1', { node_key: 'runtime-search_tools-1' }));
        console.log('rows', rows.length);
        return { rows: rows.length, node_keys: schemas.map((schema) => schema.node_key) };
      `,
    );

    expect(execution.result).toMatchObject({
      success: true,
      data: {
        result: {
          rows: 3,
          node_keys: ['runtime-search_tools-1', 'runtime-search_tools-1', 'runtime-search_tools-1'],
        },
        logs: ['rows 3'],
        tool_calls: 3,
      },
    });
    const tool_calls = await list_run_tool_calls(
      fixture.db,
      fixture.actor.workspace_id,
      fixture.run.run_id,
    );
    expect(tool_calls.map((call) => call.tool_name).sort()).toEqual([
      'runtime-get_tool_schema-1',
      'runtime-get_tool_schema-1',
      'runtime-get_tool_schema-1',
      'runtime-run_program-1',
    ]);
    const messages = await list_run_messages(
      fixture.db,
      fixture.actor.workspace_id,
      fixture.run.run_id,
    );
    const inner = messages.filter(
      (message) => message.message_role === 'tool_result' && message.is_model_visible === false,
    );
    expect(inner).toHaveLength(3);
  });

  it('reports a failing tool and a failing program without throwing', async () => {
    const fixture = await create_fixture();
    const refused = await run_program_tool(fixture, `return call_tool('no-such-tool-1', {})`);
    expect(refused.result).toMatchObject({ success: false, error: { code: 'program_failed' } });
    const broken = await run_program_tool(fixture, `return undefinedThing.x`);
    expect(broken.result).toMatchObject({
      success: false,
      error: { code: 'program_failed', message: expect.stringContaining('ReferenceError') },
    });
  });
});
