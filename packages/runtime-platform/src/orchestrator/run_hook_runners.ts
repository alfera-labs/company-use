import type {
  BeforeRuntimeTurn,
  RuntimeTurnDecision,
  RuntimeTurnState,
  RuntimeTurnSteer,
} from '@agent-core/runs/agent_run';
import { AppError, create_logger } from '@coworker/shared';
import {
  attempt_run_hook,
  describe_run_hook_failure,
  type RunHookFailure,
  type RunHookLogContext,
  type RunHookPhase,
  type RunHookRecord,
  reported_run_hook_failure,
} from '@runtime-platform/orchestrator/run_hook_attempt';
import type {
  BeforeTurnHook,
  PrepareEnvironmentHook,
  RunHookResult,
  RunOutcome,
  SettleRunHook,
} from '@runtime-platform/orchestrator/run_hooks';
import type { OpenedCodingWorkspace } from '@runtime-platform/orchestrator/workspace_runtime';

const log = create_logger('run_hooks');

export type RunHookReport = { hook_name: string } & (
  | { outcome: 'done' }
  | { outcome: 'failed'; failure: RunHookFailure }
);

export async function run_prepare_hooks(
  hooks: readonly PrepareEnvironmentHook[],
  workspace: OpenedCodingWorkspace,
  log_context: RunHookLogContext,
): Promise<RunHookReport[]> {
  return run_hooks_in_order(hooks, async (hook) => {
    const report = await run_one_hook(hook, 'prepare', log_context, (signal) =>
      hook.run(workspace, signal),
    );
    if (report.outcome === 'failed' && hook.on_failure === 'stop_run') {
      throw new AppError(
        'run_hook_stopped_run',
        `The ${hook.hook_name} step could not prepare the sandbox: ${describe_run_hook_failure(report.failure)}`,
        503,
      );
    }
    return report;
  });
}

export async function run_settle_hooks(
  hooks: readonly SettleRunHook[],
  input: { workspace: OpenedCodingWorkspace; run_outcome: RunOutcome },
  log_context: RunHookLogContext,
): Promise<RunHookReport[]> {
  return run_hooks_in_order(hooks, (hook) =>
    run_one_hook(hook, 'settle', { ...log_context, run_outcome: input.run_outcome }, (signal) =>
      hook.run(input, signal),
    ),
  );
}

export function compose_before_turn(
  gate: BeforeRuntimeTurn,
  hooks: readonly BeforeTurnHook[],
  log_context: RunHookLogContext,
): BeforeRuntimeTurn {
  const steered_hooks = new Set<BeforeTurnHook>();
  return async (state) => {
    await gate(state);
    if (hooks.length === 0) return { outcome: 'continue' };
    const steers = await Promise.all(
      hooks.map((hook) => ask_hook_to_steer(hook, state, log_context)),
    );
    return steer_decision(steers.filter((steer) => keep_steer(steer, steered_hooks, log_context)));
  };
}

type HookSteer = { hook: BeforeTurnHook; steer: RuntimeTurnSteer } | undefined;

async function ask_hook_to_steer(
  hook: BeforeTurnHook,
  state: RuntimeTurnState,
  log_context: RunHookLogContext,
): Promise<HookSteer> {
  const context = { ...log_context, turn_index: state.turn_index };
  const attempt = await attempt_run_hook({
    hook,
    phase: 'before_turn',
    log_context: context,
    signal: undefined,
    run: (signal) => hook.run(state, signal),
  });
  if (attempt.outcome === 'failed' || attempt.value.outcome === 'continue') return undefined;
  return { hook, steer: attempt.value.steer };
}

function keep_steer(
  hook_steer: HookSteer,
  steered_hooks: Set<BeforeTurnHook>,
  log_context: RunHookLogContext,
): hook_steer is NonNullable<HookSteer> {
  if (!hook_steer) return false;
  const { hook } = hook_steer;
  if (hook.steer_frequency === 'once_per_run' && steered_hooks.has(hook)) {
    log.info('A once-per-run hook asked to steer again; the steer was dropped.', {
      ...log_context,
      hook_name: hook.hook_name,
    });
    return false;
  }
  steered_hooks.add(hook);
  return true;
}

function steer_decision(kept: readonly NonNullable<HookSteer>[]): RuntimeTurnDecision {
  if (kept.length === 0) return { outcome: 'continue' };
  return { outcome: 'steer', steers: kept.map((hook_steer) => hook_steer.steer) };
}

async function run_one_hook(
  hook: RunHookRecord,
  phase: RunHookPhase,
  log_context: RunHookLogContext,
  run: (signal: AbortSignal) => Promise<RunHookResult<'prepared' | 'settled'>>,
): Promise<RunHookReport> {
  const attempt = await attempt_run_hook({ hook, phase, log_context, signal: undefined, run });
  if (attempt.outcome === 'failed') {
    return { hook_name: hook.hook_name, outcome: 'failed', failure: attempt.failure };
  }
  if (attempt.value.outcome !== 'failed') return { hook_name: hook.hook_name, outcome: 'done' };
  const failure = reported_run_hook_failure({ hook, phase, log_context }, attempt.value.reason);
  return { hook_name: hook.hook_name, outcome: 'failed', failure };
}

function run_hooks_in_order<Hook>(
  hooks: readonly Hook[],
  run_hook: (hook: Hook) => Promise<RunHookReport>,
): Promise<RunHookReport[]> {
  return hooks.reduce(
    async (previous, hook) => [...(await previous), await run_hook(hook)],
    Promise.resolve<RunHookReport[]>([]),
  );
}
