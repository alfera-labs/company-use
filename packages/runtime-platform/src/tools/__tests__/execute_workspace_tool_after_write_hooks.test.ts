import type { SessionEnv } from '@agent-core/environment';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_session,
  list_run_tool_calls,
} from '@coworker/core/db/queries/sessions';
import type { AfterWorkspaceWriteHook } from '@runtime-platform/tools/after_workspace_write_hooks';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
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
  return {
    db,
    ids: {
      workspace_id: actor.workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      actor_id: actor.user_id,
    },
  };
}

function create_recording_environment(order: string[]) {
  const written_paths = new Set<string>();
  const environment: SessionEnv = {
    env_key: 'sandbox_1',
    env_kind: 'remote_sandbox',
    write: async (path) => {
      written_paths.add(path);
      if (path === 'skills/INDEX.json' || path === 'skills/index.md') {
        order.push('fixed_hook_wrote_index');
      } else {
        order.push('tool_wrote_the_file');
      }
    },
    list: async () => [],
  };
  return { environment, written_paths };
}

function recording_after_write_hook(
  order: string[],
  written_paths: Set<string>,
): AfterWorkspaceWriteHook {
  return {
    hook_name: 'recording_hook',
    timeout_ms: 1_000,
    async run(_input) {
      order.push('run_hook_ran');
      expect(written_paths.has('skills/notes.md')).toBe(true);
      const replaced: RuntimeToolResult = {
        ok: true,
        content_text: 'the hook saw the landed bytes',
      };
      return { outcome: 'replaced_result', result: replaced };
    },
  };
}

describe('execute_workspace_tool with a run-bound after-write hook', () => {
  it('runs the fixed hook list before the run hook, after the bytes land, and stores the replaced result', async () => {
    const fixture = await create_fixture();
    const order: string[] = [];
    const { environment, written_paths } = create_recording_environment(order);
    const hook = recording_after_write_hook(order, written_paths);

    const tool = create_runtime_tool_definitions(fixture.db, {
      ...fixture.ids,
      environment,
      after_write_hooks: [hook],
    }).find((definition) => definition.tool_name === 'workspace-write_file');
    if (!tool?.execute) throw new Error('workspace-write_file is not offered.');

    const result = await tool.execute(
      { path: 'skills/notes.md', content: 'hello' },
      {
        run_key: fixture.ids.run_id,
        session_key: fixture.ids.session_id,
        tool_call_id: 'model_write_1',
        metadata: {},
        environment,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.content_text).toBe('the hook saw the landed bytes');

    expect(order[0]).toBe('tool_wrote_the_file');
    expect(order.indexOf('fixed_hook_wrote_index')).toBeGreaterThan(0);
    expect(order.indexOf('fixed_hook_wrote_index')).toBeLessThan(order.indexOf('run_hook_ran'));

    const [stored_call] = await list_run_tool_calls(
      fixture.db,
      fixture.ids.workspace_id,
      fixture.ids.run_id,
    );
    expect(stored_call?.output_text).toBe('the hook saw the landed bytes');
  });
});
