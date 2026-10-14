import type { RuntimeTurnState, RuntimeTurnSteer } from '@agent-core/runs/agent_run';
import type { Database } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import type { create_run, get_session } from '@coworker/core/db/queries/sessions';
import type { MemoryRun } from '@runtime-platform/memory_host/memory_run_hooks';
import type { resolve_chat_speaker } from '@runtime-platform/orchestrator/chat_speaker';
import type { RunHookRecord } from '@runtime-platform/orchestrator/run_hook_attempt';
import type { OpenedCodingWorkspace } from '@runtime-platform/orchestrator/workspace_runtime';
import type { AfterWorkspaceWriteHook } from '@runtime-platform/tools/after_workspace_write_hooks';
import type {
  RuntimeToolSourceMetadata,
  RuntimeToolSourceType,
} from '@runtime-platform/tools/types';

/** How a run ends, as the settle hooks see it. A cancelled run settles as `aborted`. */
export type RunOutcome = 'completed' | 'waiting' | 'aborted' | 'failed';

/** What a prepare or settle hook reports. Expected failures come back as data, not as a throw. */
export type RunHookResult<Done extends string> =
  | { outcome: Done }
  | { outcome: 'failed'; reason: string };

/**
 * Runs once the sandbox is attached, before the model starts. `stop_run` makes a failure fail the
 * attach, so the run gets no sandbox; `continue_run` logs it and goes on. A hook with
 * `holds_root_path` does not hold the attach: it runs alongside the run. Reads that name that root
 * wait for it for a short budget; writes, commands, and the settle hooks wait until it is done.
 * Such a hook never stops the run.
 */
export type PrepareEnvironmentHook = RunHookRecord & {
  on_failure: 'continue_run' | 'stop_run';
  holds_root_path?: string;
  run(workspace: OpenedCodingWorkspace, signal: AbortSignal): Promise<RunHookResult<'prepared'>>;
};

/** What a before-turn hook asks for. */
export type BeforeTurnHookResult =
  | { outcome: 'continue' }
  | { outcome: 'steer'; steer: RuntimeTurnSteer };

/** Runs before each model turn. `once_per_run` drops every steer after the first one. */
export type BeforeTurnHook = RunHookRecord & {
  steer_frequency: 'once_per_run' | 'every_turn';
  run(state: RuntimeTurnState, signal: AbortSignal): Promise<BeforeTurnHookResult>;
};

/** Runs at run end on every terminal path, before the sandbox closes or is marked failed. */
export type SettleRunHook = RunHookRecord & {
  run(
    input: { workspace: OpenedCodingWorkspace; run_outcome: RunOutcome },
    signal: AbortSignal,
  ): Promise<RunHookResult<'settled'>>;
};

/** Every hook one run carries, bound to that run. Lists run in order. */
export type RunHooks = {
  prepare: readonly PrepareEnvironmentHook[];
  after_workspace_write: readonly AfterWorkspaceWriteHook[];
  before_turn: readonly BeforeTurnHook[];
  settle: readonly SettleRunHook[];
};

/** A run with no hooks: today's behavior. */
export const empty_run_hooks: RunHooks = {
  prepare: [],
  after_workspace_write: [],
  before_turn: [],
  settle: [],
};

/** Joins hook sets list by list, keeping each set's order. */
export function merge_run_hooks(hook_sets: readonly RunHooks[]): RunHooks {
  return {
    prepare: hook_sets.flatMap((hooks) => hooks.prepare),
    after_workspace_write: hook_sets.flatMap((hooks) => hooks.after_workspace_write),
    before_turn: hook_sets.flatMap((hooks) => hooks.before_turn),
    settle: hook_sets.flatMap((hooks) => hooks.settle),
  };
}

/** The facts of the run request that decide its audience: where it came from and what started it. */
export type RunStartFacts = {
  source_type?: RuntimeToolSourceType;
  user_message_source_metadata?: RuntimeToolSourceMetadata;
  trigger_type?: Parameters<typeof create_run>[1]['trigger_type'];
  trigger_id?: string;
  automation_id?: string;
  run_metadata?: Record<string, unknown>;
};

/** What a hook source reads when a run starts, to decide which hooks that run carries. */
export type RunHookSourceInput = {
  db: Database;
  workspace_id: string;
  session_id: string;
  run_id: string;
  actor_id: string;
  session: NonNullable<Awaited<ReturnType<typeof get_session>>>;
  participants: Participants;
  speaker: Awaited<ReturnType<typeof resolve_chat_speaker>>;
  room_private_to: string | null;
  start: RunStartFacts;
  memory_run?: Promise<MemoryRun | null>;
};
