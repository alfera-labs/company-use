import type { SessionEnv } from '@agent-core/environment';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import {
  attempt_run_hook,
  type RunHookFailure,
  type RunHookRecord,
  reported_run_hook_failure,
} from '@runtime-platform/orchestrator/run_hook_attempt';
import {
  compile_workspace_skill_index,
  path_changes_skill_index,
} from '@runtime-platform/skills/compile_workspace_skill_index';

/** One workspace tool call whose effects just landed, before its result is stored. */
export type AfterWorkspaceWriteInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string;
  actor_id: string;
  tool_name: string;
  tool_call_id: string;
  tool_input: Readonly<Record<string, unknown>>;
  environment: SessionEnv | undefined;
  result: RuntimeToolResult;
};

/** What a hook did to the tool result. */
export type AfterWorkspaceWriteResult =
  | { outcome: 'unchanged' }
  | { outcome: 'replaced_result'; result: RuntimeToolResult }
  | { outcome: 'failed'; reason: string };

/**
 * A hook that runs inside every workspace tool call, after the bytes land and before the result is
 * stored. Hooks run in list order and each one sees the result the previous one returned. When a
 * hook fails, `result_after_failure` may word the failure into the result the model reads.
 */
export type AfterWorkspaceWriteHook = RunHookRecord & {
  run(input: AfterWorkspaceWriteInput, signal: AbortSignal): Promise<AfterWorkspaceWriteResult>;
  result_after_failure?(result: RuntimeToolResult, failure: RunHookFailure): RuntimeToolResult;
};

const recompile_skill_index_hook: AfterWorkspaceWriteHook = {
  hook_name: 'skill_index_recompile',
  timeout_ms: 60_000,
  async run(input) {
    const workspace_path = input.result.metadata?.workspace_path;
    if (!input.environment?.write) return { outcome: 'unchanged' };
    if (typeof workspace_path !== 'string' || !path_changes_skill_index(workspace_path)) {
      return { outcome: 'unchanged' };
    }
    await compile_workspace_skill_index(input.environment);
    return { outcome: 'unchanged' };
  },
};

/** The hooks every workspace tool call runs, before the hooks of its run. */
export const after_workspace_write_hooks: readonly AfterWorkspaceWriteHook[] = [
  recompile_skill_index_hook,
];

/** Runs the fixed hooks, then the run's own hooks, and returns the result to store. */
export async function run_after_workspace_write_hooks(
  run_hooks: readonly AfterWorkspaceWriteHook[] | undefined,
  input: AfterWorkspaceWriteInput,
  signal: AbortSignal | undefined,
): Promise<RuntimeToolResult> {
  const hooks = [...after_workspace_write_hooks, ...(run_hooks ?? [])];
  return hooks.reduce(
    async (previous, hook) =>
      apply_hook_in_order(hook, { ...input, result: await previous }, signal),
    Promise.resolve(input.result),
  );
}

async function apply_hook_in_order(
  hook: AfterWorkspaceWriteHook,
  input: AfterWorkspaceWriteInput,
  signal: AbortSignal | undefined,
): Promise<RuntimeToolResult> {
  const log_context = {
    run_id: input.run_id,
    workspace_id: input.workspace_id,
    tool_name: input.tool_name,
    tool_call_id: input.tool_call_id,
  };
  const step = { hook, phase: 'after_workspace_write' as const, log_context };
  const attempt = await attempt_run_hook({
    ...step,
    signal,
    run: (hook_signal) => hook.run(input, hook_signal),
  });
  if (attempt.outcome === 'failed') return result_after(hook, input.result, attempt.failure);
  if (attempt.value.outcome === 'replaced_result') return attempt.value.result;
  if (attempt.value.outcome === 'unchanged') return input.result;
  const failure = reported_run_hook_failure(step, attempt.value.reason);
  return result_after(hook, input.result, failure);
}

function result_after(
  hook: AfterWorkspaceWriteHook,
  result: RuntimeToolResult,
  failure: RunHookFailure,
) {
  return hook.result_after_failure ? hook.result_after_failure(result, failure) : result;
}
