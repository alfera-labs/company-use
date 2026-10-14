import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent, RuntimeAgentEngineInput } from '@agent-core/runs';
import { empty_run_usage } from '@agent-core/runs/run_usage';
import { billable_usage_microcents } from '@coworker/config/credit_pricing';
import { plans } from '@coworker/config/plans';
import {
  assert_workspace_has_credit,
  assert_workspace_may_sync_brain,
  billing_is_enabled,
  find_workspace_plan,
  grant_welcome_credit,
  workspace_billing_context_line,
  workspace_may_run_billed_background_work,
  workspace_model_access,
} from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { get_credit_balance_microcents } from '@coworker/core/db/queries/billing';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import {
  hold_job_for_credit_top_up,
  job_is_still_waiting_for_credit,
} from '@runtime-platform/events/credit_top_up_hold';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { create_mid_run_credit_gate } from '@runtime-platform/orchestrator/mid_run_credit_gate';
import {
  begin_run_start_credit_gates,
  check_run_start_credit_gates,
} from '@runtime-platform/orchestrator/run_start_credit_gates';
import { start_agent_run } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { wait_for_all_workspace_close_work } from '@runtime-platform/orchestrator/workspace_close_queue';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ScriptedTurn = (input: RuntimeAgentEngineInput) => AsyncIterable<RuntimeAgentEngineEvent>;

const scripted_turns: ScriptedTurn[] = [];

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
  configure_agent_engine(() => ({
    engine_name: 'agent-core/pi/run-checks-answer-allowed-test',
    run(input: RuntimeAgentEngineInput) {
      const turn = scripted_turns.shift();
      if (!turn) throw new Error('The test did not script this model call.');
      return turn(input);
    },
  }));
});

afterEach(() => {
  configure_agent_engine(create_pi_engine);
  scripted_turns.length = 0;
  vi.unstubAllEnvs();
});

async function seed_workspace_with_no_credit_and_no_plan() {
  const db = await create_test_database();
  await seed_runtime_tool_catalog(db);
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  return { db, ...bootstrap, session_id: session.session_id };
}

describe('credit and plan checks in the path of a run', () => {
  it('lets the queue-time check, the run-start check and the job hold pass', async () => {
    const seeded = await seed_workspace_with_no_credit_and_no_plan();
    const run_input = { workspace_id: seeded.workspace_id, actor_id: seeded.user_id };

    await expect(
      check_run_start_credit_gates(seeded.db, { ...run_input, session_id: seeded.session_id }),
    ).resolves.toBeUndefined();
    await expect(
      begin_run_start_credit_gates(seeded.db, run_input)(false),
    ).resolves.toBeUndefined();
    await expect(
      job_is_still_waiting_for_credit(seeded.db, {
        workspace_id: seeded.workspace_id,
        event_jobs: [],
      }),
    ).resolves.toBe(false);
    expect(
      hold_job_for_credit_top_up({ event_jobs: [], code: 'out_of_credits', message: 'held' }),
    ).not.toHaveProperty('retry_at');
  });

  it('lets every turn start, however much the run has spent', async () => {
    const seeded = await seed_workspace_with_no_credit_and_no_plan();
    const gate = create_mid_run_credit_gate({ db: seeded.db, workspace_id: seeded.workspace_id });
    const usage = empty_run_usage();
    const costly_usage = { ...usage, cost: { ...usage.cost, total: 1_000_000 } };

    await expect(gate.before_turn({ turn_index: 9, usage: costly_usage })).resolves.toBeUndefined();
    expect(gate.stop_error()).toBeUndefined();
  });

  it('answers every plan and credit question with allowed', async () => {
    const seeded = await seed_workspace_with_no_credit_and_no_plan();
    const { db, workspace_id, user_id } = seeded;

    expect(billing_is_enabled()).toBe(false);
    await expect(assert_workspace_has_credit(db, workspace_id)).resolves.toBeUndefined();
    await expect(assert_workspace_may_sync_brain(db, workspace_id)).resolves.toBeUndefined();
    await expect(workspace_may_run_billed_background_work(db, workspace_id)).resolves.toBe(true);
    await expect(workspace_model_access(db, workspace_id)).resolves.toBe('all');
    await expect(workspace_billing_context_line(db, workspace_id)).resolves.toBeNull();
    await expect(find_workspace_plan(db, workspace_id)).resolves.toBeUndefined();
    await expect(grant_welcome_credit(db, { workspace_id, user_id })).resolves.toBe(false);
    await expect(get_credit_balance_microcents(db, workspace_id)).resolves.toBeGreaterThan(0);
  });

  it('sets no plan ceiling and adds nothing to what a model call cost', () => {
    for (const plan of Object.values(plans)) {
      expect(plan).toMatchObject({
        workspace_user_limit: null,
        scheduled_task_limit: null,
        concurrent_run_limit: null,
      });
    }
    expect(billable_usage_microcents(1_234)).toBe(1_234);
  });

  it('runs two model turns to the end for a workspace with no credit and no plan', async () => {
    const seeded = await seed_workspace_with_no_credit_and_no_plan();
    scripted_turns.push(async function* (input) {
      let usage = empty_run_usage();
      await input.before_turn?.({ turn_index: 1, usage });
      usage = { ...usage, cost: { ...usage.cost, total: 25 } };
      await input.before_turn?.({ turn_index: 2, usage });
      yield {
        type: 'message' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Done.' }],
        },
      };
    });

    const run = await start_agent_run(seeded.db, {
      workspace_id: seeded.workspace_id,
      session_id: seeded.session_id,
      user_message: 'go',
      actor_id: seeded.user_id,
      workspace_runtime_provider: 'local',
    });
    await wait_for_all_workspace_close_work();

    expect(run.run_status).toBe('completed');
  }, 60_000);
});
