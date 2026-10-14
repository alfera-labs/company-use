import type { SessionEnv, SessionEnvExecInput } from '@agent-core/environment';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_session,
  list_run_tool_calls,
} from '@coworker/core/db/queries/sessions';
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

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

function sandbox_that_runs(exec: NonNullable<SessionEnv['exec']>): SessionEnv {
  return { env_key: 'sandbox_1', env_kind: 'custom', exec };
}

async function run_a_command(fixture: Fixture, environment: SessionEnv, signal?: AbortSignal) {
  const tool = create_runtime_tool_definitions(fixture.db, { ...fixture.ids, environment }).find(
    (definition) => definition.tool_name === 'workspace-run_command',
  );
  if (!tool?.execute) throw new Error('workspace-run_command is not offered.');
  const result = await tool.execute(
    { command: 'sleep', args: ['600'] },
    {
      run_key: fixture.ids.run_id,
      session_key: fixture.ids.session_id,
      tool_call_id: 'model_command_1',
      metadata: {},
      environment,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  const [stored_call] = await list_run_tool_calls(
    fixture.db,
    fixture.ids.workspace_id,
    fixture.ids.run_id,
  );
  return { result, stored_call };
}

function exits_with_code_1_when_stopped(input: SessionEnvExecInput) {
  return new Promise<{ exit_code: number; stdout: string; stderr: string }>((resolve) => {
    input.signal?.addEventListener('abort', () =>
      resolve({ exit_code: 1, stdout: '', stderr: '' }),
    );
  });
}

describe('a command that was running when the person pressed Stop', () => {
  it('ends as cancelled, not as failed, and does not say it exited with a code', async () => {
    const fixture = await create_fixture();
    const stop = new AbortController();
    const environment = sandbox_that_runs(exits_with_code_1_when_stopped);

    const running = run_a_command(fixture, environment, stop.signal);
    setTimeout(() => stop.abort(), 20);
    const { result, stored_call } = await running;

    expect(result).toMatchObject({ ok: false, error_code: 'cancelled' });
    expect(stored_call?.tool_status).toBe('cancelled');
    expect(stored_call?.error_code).toBe('cancelled');
    expect(stored_call?.error_message).toBe('Stopped before it finished.');
    expect(stored_call?.error_message).not.toContain('exited with code');
  });

  it('ends as cancelled when the sandbox throws on the stop', async () => {
    const fixture = await create_fixture();
    const stop = new AbortController();
    const environment = sandbox_that_runs(
      (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const running = run_a_command(fixture, environment, stop.signal);
    setTimeout(() => stop.abort(), 20);
    const { stored_call } = await running;

    expect(stored_call?.tool_status).toBe('cancelled');
  });

  it('still fails with its exit code when nobody stopped it', async () => {
    const fixture = await create_fixture();
    const environment = sandbox_that_runs(async () => ({ exit_code: 1, stdout: '', stderr: '' }));

    const { result, stored_call } = await run_a_command(fixture, environment);

    expect(result).toMatchObject({ ok: false, error_code: 'command_failed' });
    expect(stored_call?.tool_status).toBe('failed');
    expect(stored_call?.error_message).toContain('Command exited with code 1.');
  });

  it('keeps its result when it finished before the stop', async () => {
    const fixture = await create_fixture();
    const stop = new AbortController();
    const environment = sandbox_that_runs(async () => {
      stop.abort();
      return { exit_code: 0, stdout: 'done', stderr: '' };
    });

    const { result, stored_call } = await run_a_command(fixture, environment, stop.signal);

    expect(result).toMatchObject({ ok: true });
    expect(stored_call?.tool_status).toBe('completed');
  });
});
