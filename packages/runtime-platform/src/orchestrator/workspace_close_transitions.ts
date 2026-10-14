import type { Database } from '@coworker/core';
import {
  get_runtime_environment,
  update_runtime_environment_state,
} from '@coworker/core/db/queries/sessions';
import { AppError, format_error_message } from '@coworker/shared';
import { set_e2b_sandbox_idle_timeout } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import {
  type ClosedRuntimeEnvironmentCompute,
  claim_workspace_close,
  find_replayed_workspace_close,
  publish_closed_runtime_environment,
  reap_runtime_environment_compute,
} from '@runtime-platform/orchestrator/workspace_close';
import { runtime_environment_has_active_preview } from '@runtime-platform/orchestrator/workspace_preview_liveness';
import type { CodingWorkspaceCloseToken } from '@runtime-platform/orchestrator/workspace_runtime';

async function keep_coding_workspace_running_for_active_preview(
  db: Database,
  input: {
    workspace_id: string;
    runtime_environment_id: string;
    close_token?: CodingWorkspaceCloseToken;
    actor_id: string;
  },
) {
  const environment = await get_runtime_environment(db, input);
  if (
    environment?.environment_metadata.browser_started === true &&
    environment.environment_provider === 'e2b' &&
    environment.provider_environment_id &&
    (!input.close_token?.provider_environment_id ||
      input.close_token.provider_environment_id === environment.provider_environment_id)
  ) {
    await set_e2b_sandbox_idle_timeout(environment.provider_environment_id);
  }
  return update_runtime_environment_state(db, {
    runtime_environment_id: input.runtime_environment_id,
    environment_status: 'running',
    merge_environment_metadata: {
      last_preview_keepalive_time: new Date().toISOString(),
    },
    actor_id: input.actor_id,
  });
}

export async function mark_coding_workspace_idle(
  db: Database,
  input: {
    workspace_id: string;
    runtime_environment_id: string;
    close_token?: CodingWorkspaceCloseToken;
    actor_id: string;
  },
) {
  if (await runtime_environment_has_active_preview(db, input)) {
    return keep_coding_workspace_running_for_active_preview(db, input);
  }
  const replayed_close = await find_replayed_workspace_close(db, input);
  if (replayed_close) return replayed_close;
  const close_claim = await claim_workspace_close(db, input);
  if (!close_claim.claimed) return close_claim.environment;

  let close_result: ClosedRuntimeEnvironmentCompute;
  try {
    close_result = await reap_runtime_environment_compute(db, input);
  } catch (error) {
    if (is_stale_workspace_close(error)) throw error;
    await update_runtime_environment_state(db, {
      runtime_environment_id: input.runtime_environment_id,
      environment_status: 'failed',
      merge_environment_metadata: {
        last_reap_error_message: format_error_message(error),
      },
      actor_id: input.actor_id,
    });
    throw error;
  }

  return publish_closed_runtime_environment(db, {
    runtime_environment_id: input.runtime_environment_id,
    environment_status: 'idle',
    close_result,
    actor_id: input.actor_id,
  });
}

export async function mark_coding_workspace_failed(
  db: Database,
  input: {
    workspace_id: string;
    runtime_environment_id: string;
    error_message: string;
    close_token?: CodingWorkspaceCloseToken;
    actor_id: string;
  },
) {
  const replayed_close = await find_replayed_workspace_close(db, input);
  if (replayed_close) return replayed_close;
  const close_claim = await claim_workspace_close(db, input);
  if (!close_claim.claimed) return close_claim.environment;

  let close_result: ClosedRuntimeEnvironmentCompute;
  try {
    close_result = await reap_runtime_environment_compute(db, input);
  } catch (error) {
    if (is_stale_workspace_close(error)) throw error;
    await update_runtime_environment_state(db, {
      runtime_environment_id: input.runtime_environment_id,
      environment_status: 'failed',
      merge_environment_metadata: {
        error_message: input.error_message,
        last_failed_time: new Date().toISOString(),
        last_reap_error_message: format_error_message(error),
      },
      actor_id: input.actor_id,
    });
    throw error;
  }

  return publish_closed_runtime_environment(db, {
    runtime_environment_id: input.runtime_environment_id,
    environment_status: 'failed',
    merge_environment_metadata: {
      error_message: input.error_message,
      last_failed_time: new Date().toISOString(),
    },
    close_result,
    actor_id: input.actor_id,
  });
}

function is_stale_workspace_close(error: unknown) {
  return error instanceof AppError && error.code === 'stale_workspace_close';
}
