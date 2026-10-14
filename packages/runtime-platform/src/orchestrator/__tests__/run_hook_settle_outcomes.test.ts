import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import { empty_run_usage } from '@agent-core/runs/run_usage';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_session,
  get_runtime_environment,
  list_session_messages,
} from '@coworker/core/db/queries/sessions';
import { runs } from '@coworker/core/db/schema';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import type {
  BeforeTurnHook,
  RunHooks,
  RunOutcome,
  SettleRunHook,
} from '@runtime-platform/orchestrator/run_hooks';
import {
  cancel_agent_run,
  start_agent_run,
} from '@runtime-platform/orchestrator/runtime_orchestrator';
import { wait_for_all_workspace_close_work } from '@runtime-platform/orchestrator/workspace_close_queue';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ScriptedTurn = (input: RuntimeAgentEngineInput) => AsyncIterable<RuntimeAgentEngineEvent>;

const engine_run: { turns: ScriptedTurn[] } = { turns: [] };

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
  configure_agent_engine(() => ({
    engine_name: 'agent-core/pi/run-hook-settle-outcomes-test',
    run(input: RuntimeAgentEngineInput) {
      const turn = engine_run.turns.shift();
      if (!turn) throw new Error('The test did not script this model call.');
      return turn(input);
    },
  }));
});

afterEach(() => {
  configure_agent_engine(create_pi_engine);
  engine_run.turns.length = 0;
  vi.unstubAllEnvs();
});

const hidden_steer_text = 'a hidden steer the model reads but the session never stores';

function recording_settle_hook(
  db: Database,
  seen: RunOutcome[],
  status_at_settle: Array<string | undefined>,
): SettleRunHook {
  return {
    hook_name: 'recording_settle',
    timeout_ms: 5_000,
    async run(input) {
      seen.push(input.run_outcome);
      const environment = await get_runtime_environment(db, {
        workspace_id: input.workspace.workspace_id,
        runtime_environment_id: input.workspace.runtime_environment_id,
      });
      status_at_settle.push(environment?.environment_status);
      return { outcome: 'settled' };
    },
  };
}

function recording_before_turn_hook(seen: number[]): BeforeTurnHook {
  return {
    hook_name: 'recording_steer',
    timeout_ms: 5_000,
    steer_frequency: 'once_per_run',
    async run(state) {
      seen.push(state.turn_index);
      return { outcome: 'steer', steer: { text: hidden_steer_text, hidden: true } };
    },
  };
}

function run_hooks_for(
  db: Database,
  settled: RunOutcome[],
  steered: number[],
  status_at_settle: Array<string | undefined>,
): RunHooks {
  return {
    prepare: [],
    after_workspace_write: [],
    before_turn: [recording_before_turn_hook(steered)],
    settle: [recording_settle_hook(db, settled, status_at_settle)],
  };
}

async function seed_workspace(db: Database) {
  await seed_runtime_tool_catalog(db);
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  return { ...bootstrap, session_id: session.session_id };
}

function assistant_says(text: string) {
  return {
    type: 'message' as const,
    message: { role: 'assistant' as const, content: [{ type: 'text' as const, text }] },
  };
}

async function visible_texts(db: Database, ids: { workspace_id: string; session_id: string }) {
  const messages = await list_session_messages(db, ids.workspace_id, ids.session_id);
  return messages
    .filter((message) => message.message_role === 'assistant')
    .map((message) => message.content_text);
}

describe('settle hooks wired through start_agent_run', () => {
  it('settle a completed run as "completed", before the sandbox is marked idle, and never store its hidden steer', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const settled: RunOutcome[] = [];
    const steered: number[] = [];
    const status_at_settle: Array<string | undefined> = [];
    const decisions: unknown[] = [];
    engine_run.turns.push(async function* (input) {
      decisions.push(await input.before_turn?.({ turn_index: 1, usage: empty_run_usage() }));
      decisions.push(await input.before_turn?.({ turn_index: 2, usage: empty_run_usage() }));
      yield assistant_says('All done.');
    });

    const run = await start_agent_run(
      db,
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        user_message: 'go',
        actor_id: seeded.user_id,
        workspace_runtime_provider: 'local',
      },
      { run_hooks: run_hooks_for(db, settled, steered, status_at_settle) },
    );
    await wait_for_all_workspace_close_work();

    expect(run.run_status).toBe('completed');
    expect(settled).toEqual(['completed']);
    expect(steered).toEqual([1, 2]);
    expect(status_at_settle[0]).not.toBe('idle');
    expect(decisions).toEqual([
      { outcome: 'steer', steers: [{ text: hidden_steer_text, hidden: true }] },
      { outcome: 'continue' },
    ]);
    expect(await visible_texts(db, seeded)).not.toContain(hidden_steer_text);
  }, 60_000);

  it('runs every later settle hook after one throws, one times out, and one reports a failure', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const order: string[] = [];
    const settled: RunOutcome[] = [];
    const status_at_settle: Array<string | undefined> = [];
    engine_run.turns.push(async function* () {
      yield assistant_says('All done.');
    });
    const failing_settle_hooks: SettleRunHook[] = [
      {
        hook_name: 'throws',
        timeout_ms: 5_000,
        async run() {
          order.push('throws');
          throw new Error('settle boom');
        },
      },
      {
        hook_name: 'slow',
        timeout_ms: 200,
        async run() {
          order.push('slow');
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          order.push('slow_finished_late');
          return { outcome: 'settled' };
        },
      },
      {
        hook_name: 'reports',
        timeout_ms: 5_000,
        async run() {
          order.push('reports');
          return { outcome: 'failed', reason: 'could not save' };
        },
      },
    ];

    const run = await start_agent_run(
      db,
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        user_message: 'go',
        actor_id: seeded.user_id,
        workspace_runtime_provider: 'local',
      },
      {
        run_hooks: {
          prepare: [],
          after_workspace_write: [],
          before_turn: [],
          settle: [...failing_settle_hooks, recording_settle_hook(db, settled, status_at_settle)],
        },
      },
    );
    await wait_for_all_workspace_close_work();

    expect(run.run_status).toBe('completed');
    expect(order).toEqual(['throws', 'slow', 'reports']);
    expect(settled).toEqual(['completed']);
    expect(status_at_settle[0]).not.toBe('idle');
  }, 60_000);

  it('settle a waiting run as "waiting"', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const settled: RunOutcome[] = [];
    engine_run.turns.push(async function* (input) {
      await db
        .update(runs)
        .set({ waiting_on_job_id: 'job_test_wait' })
        .where(eq(runs.run_id, input.run_key));
      yield assistant_says('Waiting on a tool approval.');
    });

    const run = await start_agent_run(
      db,
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        user_message: 'go',
        actor_id: seeded.user_id,
        workspace_runtime_provider: 'local',
      },
      { run_hooks: run_hooks_for(db, settled, [], []) },
    );
    await wait_for_all_workspace_close_work();

    expect(run.run_status).toBe('waiting');
    expect(settled).toEqual(['waiting']);
  }, 60_000);

  it('settle a cancelled run as "aborted"', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const settled: RunOutcome[] = [];
    let announce_run: (run_id: string) => void = () => undefined;
    const run_started = new Promise<string>((resolve) => {
      announce_run = resolve;
    });
    engine_run.turns.push(async function* (input) {
      announce_run(input.run_key);
      await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
    });

    const running = start_agent_run(
      db,
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        user_message: 'go',
        actor_id: seeded.user_id,
        workspace_runtime_provider: 'local',
      },
      { run_hooks: run_hooks_for(db, settled, [], []) },
    );
    const run_id = await run_started;
    await cancel_agent_run(db, {
      workspace_id: seeded.workspace_id,
      run_id,
      actor_id: seeded.user_id,
    });
    const run = await running;
    await wait_for_all_workspace_close_work();

    expect(run.run_status).toBe('cancelled');
    expect(settled).toEqual(['aborted']);
  }, 60_000);

  it('settle a run whose model call fails mid-turn as "failed", before the sandbox is marked failed', async () => {
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    const settled: RunOutcome[] = [];
    const status_at_settle: Array<string | undefined> = [];
    engine_run.turns.push(async function* (input) {
      await input.before_turn?.({ turn_index: 1, usage: empty_run_usage() });
      yield assistant_says('Turn 1 did its part.');
      throw new Error('provider said 502: upstream unavailable');
    });

    const failure = await start_agent_run(
      db,
      {
        workspace_id: seeded.workspace_id,
        session_id: seeded.session_id,
        user_message: 'go',
        actor_id: seeded.user_id,
        workspace_runtime_provider: 'local',
      },
      { run_hooks: run_hooks_for(db, settled, [], status_at_settle) },
    ).catch((error: unknown) => error);
    await wait_for_all_workspace_close_work();

    expect(failure).toMatchObject({ message: 'provider said 502: upstream unavailable' });
    const [failed_run] = await db.select().from(runs).where(eq(runs.session_id, seeded.session_id));
    expect(failed_run?.run_status).toBe('failed');
    expect(settled).toEqual(['failed']);
    expect(status_at_settle[0]).not.toBe('failed');
  }, 60_000);
});
