import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { AgentRunStoppedError } from '@runtime-platform/orchestrator/agent_run_stopped';
import type { RunHooks, RunOutcome, SettleRunHook } from '@runtime-platform/orchestrator/run_hooks';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { wait_for_all_workspace_close_work } from '@runtime-platform/orchestrator/workspace_close_queue';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ScriptedTurn = (input: RuntimeAgentEngineInput) => AsyncIterable<RuntimeAgentEngineEvent>;

const engine_run: { turns: ScriptedTurn[] } = { turns: [] };

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-never-sent');
  configure_agent_engine(() => ({
    engine_name: 'agent-core/pi/run-hook-lost-claim-test',
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

function recording_settle_hook(seen: RunOutcome[]): SettleRunHook {
  return {
    hook_name: 'recording_settle',
    timeout_ms: 5_000,
    async run(input) {
      seen.push(input.run_outcome);
      return { outcome: 'settled' };
    },
  };
}

function run_hooks_for(settled: RunOutcome[]): RunHooks {
  return {
    prepare: [],
    after_workspace_write: [],
    before_turn: [],
    settle: [recording_settle_hook(settled)],
  };
}

describe('a run whose worker lost its claim', () => {
  it('runs no settle hook: the resuming worker owns settlement instead', async () => {
    const db = await create_test_database();
    await seed_runtime_tool_catalog(db);
    const bootstrap = await bootstrap_default_workspace(db);
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const settled: RunOutcome[] = [];
    const claim = new AbortController();
    engine_run.turns.push(async function* (input) {
      yield {
        type: 'message' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'working on it' }],
        },
      };
      claim.abort(new Error('The claim on this job was lost.'));
      if (!input.signal.aborted) {
        await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
      }
    });

    await expect(
      start_agent_run(
        db,
        {
          workspace_id: bootstrap.workspace_id,
          session_id: session.session_id,
          user_message: 'go',
          actor_id: bootstrap.user_id,
          workspace_runtime_provider: 'local',
        },
        { stop_signal: claim.signal, run_hooks: run_hooks_for(settled) },
      ),
    ).rejects.toBeInstanceOf(AgentRunStoppedError);
    await wait_for_all_workspace_close_work();

    expect(settled).toEqual([]);
  }, 60_000);
});
