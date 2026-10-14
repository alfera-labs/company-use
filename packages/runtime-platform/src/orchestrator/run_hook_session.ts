import type { BeforeRuntimeTurn } from '@agent-core/runs/agent_run';
import type { Database } from '@coworker/core';
import type { WorkspaceId } from '@coworker/memory/contracts/keys';
import { open_memory_run } from '@runtime-platform/memory_host/memory_run';
import { hold_root_paths_until_ready } from '@runtime-platform/orchestrator/held_root_session_env';
import { open_run_hooks } from '@runtime-platform/orchestrator/open_run_hooks';
import type { RunHookLogContext } from '@runtime-platform/orchestrator/run_hook_attempt';
import {
  compose_before_turn,
  run_prepare_hooks,
  run_settle_hooks,
} from '@runtime-platform/orchestrator/run_hook_runners';
import type {
  PrepareEnvironmentHook,
  RunHookResult,
  RunHookSourceInput,
  RunHooks,
  RunOutcome,
} from '@runtime-platform/orchestrator/run_hooks';
import {
  close_workspace_after_run,
  mark_workspace_failed_if_open,
  type WorkspaceCloseOwner,
} from '@runtime-platform/orchestrator/run_workspace_close';
import {
  build_workspace_digest,
  workspace_digest_should_write,
  write_workspace_digest,
} from '@runtime-platform/orchestrator/workspace_digest';
import type { OpenedCodingWorkspace } from '@runtime-platform/orchestrator/workspace_runtime';
import type { SkillIndex } from '@runtime-platform/skills/skill_index_artifact';

type BeforeClose = (workspace: OpenedCodingWorkspace) => Promise<void>;

export function open_run_hook_session(
  db: Database,
  owner: WorkspaceCloseOwner,
  run_facts: Omit<RunHookSourceInput, keyof WorkspaceCloseOwner | 'db'>,
  extra_hooks: RunHooks | undefined,
) {
  const memory_run = open_memory_run({ db, ...owner, ...run_facts });
  const opening_hooks = open_run_hooks({ db, ...owner, ...run_facts, memory_run }, extra_hooks);
  const log_context = { run_id: owner.run_id, workspace_id: owner.workspace_id };
  const held_roots: HeldRoots = { ready: Promise.resolve() };
  const settle = (run_outcome: RunOutcome) => async (workspace: OpenedCodingWorkspace) => {
    await held_roots.ready;
    const hooks = await opening_hooks;
    await run_settle_hooks(hooks.settle, { workspace, run_outcome }, log_context);
  };

  return {
    memory_run,
    async prepare(workspace: OpenedCodingWorkspace, skill_index: Promise<SkillIndex>) {
      const digest = workspace_digest_prepare_hook(db, owner.workspace_id, skill_index);
      const hooks = await opening_hooks;
      return prepare_run_workspace([digest, ...hooks.prepare], workspace, held_roots, log_context);
    },
    async after_workspace_write() {
      return (await opening_hooks).after_workspace_write;
    },
    before_turn(gate: BeforeRuntimeTurn): BeforeRuntimeTurn {
      const composed = opening_hooks.then((hooks) =>
        compose_before_turn(gate, hooks.before_turn, log_context),
      );
      return async (state) => (await composed)(state);
    },
    close(workspace: OpenedCodingWorkspace, run_outcome: RunOutcome, before_close?: BeforeClose) {
      close_workspace_after_run(db, workspace, owner, async (settled_workspace) => {
        await settle(run_outcome)(settled_workspace);
        await before_close?.(settled_workspace);
      });
    },
    close_without_settle(workspace: OpenedCodingWorkspace | undefined) {
      close_workspace_after_run(db, workspace, owner, () => held_roots.ready);
    },
    async fail(workspace: OpenedCodingWorkspace | undefined, error_message: string) {
      const input = { error_message, actor_id: owner.actor_id };
      await mark_workspace_failed_if_open(db, workspace, input, settle('failed'));
    },
  };
}

type HeldRoots = { ready: Promise<void> };

async function prepare_run_workspace(
  prepare_hooks: readonly PrepareEnvironmentHook[],
  workspace: OpenedCodingWorkspace,
  held_roots: HeldRoots,
  log_context: RunHookLogContext,
): Promise<OpenedCodingWorkspace> {
  const root_holds = prepare_hooks.flatMap((hook) =>
    hook.holds_root_path === undefined
      ? []
      : [
          {
            root_path: hook.holds_root_path,
            ready: run_prepare_hooks([hook], workspace, log_context).then(
              () => undefined,
              () => undefined,
            ),
          },
        ],
  );
  held_roots.ready = Promise.all(root_holds.map((hold) => hold.ready)).then(() => undefined);
  const awaited_hooks = prepare_hooks.filter((hook) => hook.holds_root_path === undefined);
  await run_prepare_hooks(awaited_hooks, workspace, log_context);
  const environment = hold_root_paths_until_ready(workspace.environment, root_holds, log_context);
  return { ...workspace, environment };
}

const workspace_digest_hook_timeout_ms = 60_000;

function workspace_digest_prepare_hook(
  db: Database,
  workspace_id: string,
  workspace_skill_index: Promise<SkillIndex>,
): PrepareEnvironmentHook {
  return {
    hook_name: 'workspace_digest',
    timeout_ms: workspace_digest_hook_timeout_ms,
    on_failure: 'continue_run',
    run: (coding_workspace) =>
      write_workspace_digest_for_run(
        coding_workspace,
        db,
        workspace_id as WorkspaceId,
        workspace_skill_index,
      ),
  };
}

async function write_workspace_digest_for_run(
  coding_workspace: OpenedCodingWorkspace,
  db: Database,
  workspace_id: WorkspaceId,
  workspace_skill_index: Promise<SkillIndex>,
): Promise<RunHookResult<'prepared'>> {
  if (!coding_workspace.volume || coding_workspace.durable_storage_unavailable) {
    return { outcome: 'prepared' };
  }
  if (!(await workspace_digest_should_write(db, workspace_id))) {
    return { outcome: 'prepared' };
  }
  const digest = await build_workspace_digest(
    coding_workspace.environment,
    await workspace_skill_index,
  );
  await write_workspace_digest(coding_workspace.environment, digest);
  return { outcome: 'prepared' };
}
