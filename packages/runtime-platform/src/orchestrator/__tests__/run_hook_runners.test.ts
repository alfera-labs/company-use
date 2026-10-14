import type { BeforeRuntimeTurn, RuntimeTurnState } from '@agent-core/runs/agent_run';
import { empty_run_usage } from '@agent-core/runs/run_usage';
import {
  compose_before_turn,
  run_prepare_hooks,
  run_settle_hooks,
} from '@runtime-platform/orchestrator/run_hook_runners';
import type {
  BeforeTurnHook,
  PrepareEnvironmentHook,
  RunOutcome,
  SettleRunHook,
} from '@runtime-platform/orchestrator/run_hooks';
import type { OpenedCodingWorkspace } from '@runtime-platform/orchestrator/workspace_runtime';
import { describe, expect, it } from 'vitest';

const log_context = { run_id: 'run_1', workspace_id: 'workspace_1' };

function fake_opened_workspace(): OpenedCodingWorkspace {
  return {
    runtime_environment_id: 'environment_1',
    workspace_id: 'workspace_1',
    workspace_mount_key: 'mount_1',
    provider: 'local',
    host_workspace_root: '/tmp/workspace_1',
    environment: { env_key: 'environment_1', env_kind: 'local' },
    close_token: {},
  };
}
const fake_workspace = fake_opened_workspace();

function turn_state(turn_index: number): RuntimeTurnState {
  return { turn_index, usage: empty_run_usage() };
}

const no_op_gate: BeforeRuntimeTurn = async () => undefined;

describe('compose_before_turn', () => {
  it('passes the model through unsteered when there are no before-turn hooks', async () => {
    const decision = await compose_before_turn(no_op_gate, [], log_context)(turn_state(1));
    expect(decision).toEqual({ outcome: 'continue' });
  });

  it('steers once from a once_per_run hook and drops its steer on the next turn', async () => {
    const hook: BeforeTurnHook = {
      hook_name: 'save_steer',
      timeout_ms: 1_000,
      steer_frequency: 'once_per_run',
      async run() {
        return { outcome: 'steer', steer: { text: 'save your notes now', hidden: true } };
      },
    };
    const before_turn = compose_before_turn(no_op_gate, [hook], log_context);
    const first_turn = await before_turn(turn_state(1));
    const second_turn = await before_turn(turn_state(2));
    expect(first_turn).toEqual({
      outcome: 'steer',
      steers: [{ text: 'save your notes now', hidden: true }],
    });
    expect(second_turn).toEqual({ outcome: 'continue' });
  });

  it('steers every turn from an every_turn hook', async () => {
    const hook: BeforeTurnHook = {
      hook_name: 'nudge',
      timeout_ms: 1_000,
      steer_frequency: 'every_turn',
      async run() {
        return { outcome: 'steer', steer: { text: 'stay on task', hidden: true } };
      },
    };
    const before_turn = compose_before_turn(no_op_gate, [hook], log_context);
    const first_turn = await before_turn(turn_state(1));
    const second_turn = await before_turn(turn_state(2));
    expect(first_turn).toEqual({
      outcome: 'steer',
      steers: [{ text: 'stay on task', hidden: true }],
    });
    expect(second_turn).toEqual({
      outcome: 'steer',
      steers: [{ text: 'stay on task', hidden: true }],
    });
  });

  it('drops the steer from a hook that throws, and runs the gate first', async () => {
    const gate_calls: number[] = [];
    const gate: BeforeRuntimeTurn = async (state) => {
      gate_calls.push(state.turn_index);
    };
    const throwing_hook: BeforeTurnHook = {
      hook_name: 'broken',
      timeout_ms: 1_000,
      steer_frequency: 'every_turn',
      async run() {
        throw new Error('db is down');
      },
    };
    const decision = await compose_before_turn(gate, [throwing_hook], log_context)(turn_state(1));
    expect(decision).toEqual({ outcome: 'continue' });
    expect(gate_calls).toEqual([1]);
  });

  it('lets the gate stop the run before any hook steers', async () => {
    const stop_gate: BeforeRuntimeTurn = async () => {
      throw new Error('credit limit reached');
    };
    const hook: BeforeTurnHook = {
      hook_name: 'save_steer',
      timeout_ms: 1_000,
      steer_frequency: 'once_per_run',
      async run() {
        return { outcome: 'steer', steer: { text: 'save your notes now', hidden: true } };
      },
    };
    await expect(
      compose_before_turn(stop_gate, [hook], log_context)(turn_state(1)),
    ).rejects.toThrow('credit limit reached');
  });
});

describe('run_prepare_hooks', () => {
  it('stops the run when a stop_run hook fails', async () => {
    const stop_hook: PrepareEnvironmentHook = {
      hook_name: 'attach_memory',
      timeout_ms: 1_000,
      on_failure: 'stop_run',
      async run() {
        return { outcome: 'failed', reason: 'could not mount the memory volume' };
      },
    };
    await expect(run_prepare_hooks([stop_hook], fake_workspace, log_context)).rejects.toThrow(
      'could not mount the memory volume',
    );
  });

  it('goes on after a continue_run hook fails', async () => {
    const continue_hook: PrepareEnvironmentHook = {
      hook_name: 'optional_setup',
      timeout_ms: 1_000,
      on_failure: 'continue_run',
      async run() {
        return { outcome: 'failed', reason: 'optional step skipped' };
      },
    };
    const reports = await run_prepare_hooks([continue_hook], fake_workspace, log_context);
    expect(reports).toEqual([
      {
        hook_name: 'optional_setup',
        outcome: 'failed',
        failure: { failure: 'reported', reason: 'optional step skipped' },
      },
    ]);
  });
});

describe('run_settle_hooks', () => {
  const outcomes: RunOutcome[] = ['completed', 'waiting', 'aborted', 'failed'];

  it.each(
    outcomes,
  )('runs on the %s terminal path and reports the outcome it saw', async (run_outcome) => {
    const seen_outcomes: RunOutcome[] = [];
    const settle_hook: SettleRunHook = {
      hook_name: 'close_memory',
      timeout_ms: 1_000,
      async run(input) {
        seen_outcomes.push(input.run_outcome);
        return { outcome: 'settled' };
      },
    };
    const reports = await run_settle_hooks(
      [settle_hook],
      { workspace: fake_workspace, run_outcome },
      log_context,
    );
    expect(seen_outcomes).toEqual([run_outcome]);
    expect(reports).toEqual([{ hook_name: 'close_memory', outcome: 'done' }]);
  });

  it('never throws, even when the settle hook throws', async () => {
    const throwing_hook: SettleRunHook = {
      hook_name: 'broken_close',
      timeout_ms: 1_000,
      async run() {
        throw new Error('volume unmount failed');
      },
    };
    const reports = await run_settle_hooks(
      [throwing_hook],
      { workspace: fake_workspace, run_outcome: 'completed' },
      log_context,
    );
    expect(reports).toEqual([
      {
        hook_name: 'broken_close',
        outcome: 'failed',
        failure: { failure: 'threw', error_message: 'volume unmount failed' },
      },
    ]);
  });
});
