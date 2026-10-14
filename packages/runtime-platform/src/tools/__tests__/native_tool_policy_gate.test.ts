import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import { set_policy } from '@coworker/core/db/queries/policies';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { execute_runtime_tool } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

describe('native tool policy gate', () => {
  it('refuses a direct runtime tool that nothing held', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);

    const execution = await execute_runtime_tool(fixture.db, {
      ...runtime_context(fixture),
      node_key: 'math-calculate-1',
      tool_input: { expression: '2 + 2' },
    });

    expect(execution.result).toMatchObject({ error: { code: 'approval_required' } });
    expect(execution.tool_call.tool_status).toBe('blocked');
    await expect_no_wait(fixture);
  });

  it('refuses through the transport tool too, without running the target', async () => {
    const fixture = await create_fixture();
    await ask_before_math(fixture);

    const execution = await execute_runtime_tool(fixture.db, {
      ...runtime_context(fixture),
      node_key: 'runtime-execute_tool-1',
      tool_input: {
        node_key: 'math-calculate-1',
        input: { expression: '2 + 2' },
      },
    });

    expect(execution.result).toMatchObject({ error: { code: 'approval_required' } });
    await expect_no_wait(fixture);
  });

  it('runs a platform tool that search handed to the transport tool', async () => {
    const fixture = await create_fixture();

    const execution = await execute_runtime_tool(fixture.db, {
      ...runtime_context(fixture),
      node_key: 'runtime-execute_tool-1',
      tool_input: {
        node_key: 'math-calculate-1',
        input: { expression: '2 + 2' },
      },
    });

    expect(execution.result).toMatchObject({ success: true, data: { result: '4' } });
  });
});

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

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function ask_before_math(fixture: Fixture) {
  await set_policy(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    resource_type: 'node',
    resource_id: 'math-calculate-1',
    scope_type: 'workspace',
    scope_id: fixture.actor.workspace_id,
    policy_mode: 'ask',
    actor_id: fixture.actor.user_id,
  });
}

function runtime_context(fixture: Fixture) {
  return {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    run_id: fixture.run.run_id,
    agent_id: fixture.actor.agent_id,
    actor_id: fixture.actor.user_id,
  };
}

async function expect_no_wait(fixture: Fixture) {
  expect(
    await list_tool_policy_waits(fixture.db, {
      workspace_id: fixture.actor.workspace_id,
      status: 'waiting',
    }),
  ).toEqual([]);
}
