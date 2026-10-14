import type { Database } from '@coworker/core';
import { get_session } from '@coworker/core/db/queries/sessions';
import { AppError, create_logger } from '@coworker/shared';
import { queue_workspace_close_work } from '@runtime-platform/orchestrator/workspace_close_queue';
import {
  mark_coding_workspace_failed,
  mark_coding_workspace_idle,
  type OpenedCodingWorkspace,
  settled_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { recompile_skill_index_if_stale } from '@runtime-platform/skills/compile_workspace_skill_index';
import { start_static_preview_if_absent } from '@runtime-platform/tools/tool_execution_service';

const log = create_logger('run_workspace_close');

export type WorkspaceCloseOwner = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  actor_id: string;
};

export function close_workspace_after_run(
  db: Database,
  opened_workspace: OpenedCodingWorkspace | undefined,
  owner: WorkspaceCloseOwner,
  before_close?: (workspace: OpenedCodingWorkspace) => Promise<void>,
) {
  if (!opened_workspace) return;
  void queue_workspace_close_work(opened_workspace.workspace_mount_key, async () => {
    const coding_workspace = await settled_coding_workspace(opened_workspace);
    await before_close?.(coding_workspace);
    if (await newer_run_holds_session(db, owner)) {
      log.info('Workspace close skipped: a newer run of the session takes the sandbox over.', {
        workspace_id: owner.workspace_id,
        session_id: owner.session_id,
        run_id: owner.run_id,
      });
      return;
    }
    await mark_workspace_idle(db, coding_workspace, owner.actor_id);
  });
}

export async function finish_workspace_before_close(
  db: Database,
  workspace: OpenedCodingWorkspace,
  input: { actor_id: string; recompile_skill_index: boolean },
) {
  if (!workspace.volume) {
    await start_static_preview_if_absent(db, {
      workspace_id: workspace.workspace_id,
      runtime_environment_id: workspace.runtime_environment_id,
      environment: workspace.environment,
      actor_id: input.actor_id,
    }).catch((error) => {
      log.warn('Could not start the static preview at run close.', {
        workspace_id: workspace.workspace_id,
        error: error_message(error),
      });
    });
  }
  if (!input.recompile_skill_index) return;
  await recompile_skill_index_if_stale(workspace.environment).catch((error) => {
    log.warn('Could not recompile the workspace skill index at run close.', {
      workspace_id: workspace.workspace_id,
      error: error_message(error),
    });
  });
}

export async function mark_workspace_failed_if_open(
  db: Database,
  opened_workspace: OpenedCodingWorkspace | undefined,
  input: { error_message: string; actor_id: string },
  before_fail?: (workspace: OpenedCodingWorkspace) => Promise<void>,
) {
  if (!opened_workspace) return;
  const coding_workspace = await settled_coding_workspace(opened_workspace);
  await before_fail?.(coding_workspace);
  await swallow_stale_workspace_close(
    mark_coding_workspace_failed(db, {
      workspace_id: coding_workspace.workspace_id,
      runtime_environment_id: coding_workspace.runtime_environment_id,
      error_message: input.error_message,
      close_token: coding_workspace.close_token,
      actor_id: input.actor_id,
    }),
  );
}

async function newer_run_holds_session(db: Database, owner: WorkspaceCloseOwner) {
  const session = await get_session(db, owner.workspace_id, owner.session_id);
  if (!session?.locked_by_run_id || session.locked_by_run_id === owner.run_id) return false;
  return !session.lock_expires_time || session.lock_expires_time > new Date();
}

async function mark_workspace_idle(
  db: Database,
  coding_workspace: OpenedCodingWorkspace,
  actor_id: string,
) {
  try {
    await swallow_stale_workspace_close(
      mark_coding_workspace_idle(db, {
        workspace_id: coding_workspace.workspace_id,
        runtime_environment_id: coding_workspace.runtime_environment_id,
        close_token: coding_workspace.close_token,
        actor_id,
      }),
    );
  } catch (error) {
    log.warn('Workspace teardown failed after the run already finished.', {
      workspace_id: coding_workspace.workspace_id,
      runtime_environment_id: coding_workspace.runtime_environment_id,
      error: error_message(error),
    });
  }
}

export async function swallow_stale_workspace_close(closing: Promise<unknown>) {
  try {
    await closing;
  } catch (error) {
    if (error instanceof AppError && error.code === 'stale_workspace_close') {
      log.info('workspace close skipped: a newer run owns the sandbox');
      return;
    }
    throw error;
  }
}

function error_message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
