import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Database } from '@coworker/core';
import {
  claim_runtime_environment_close,
  find_sandbox_by_mount_key,
  get_runtime_environment,
  update_runtime_environment_state,
  update_sandbox_state,
} from '@coworker/core/db/queries/sessions';
import { record_volume_synced } from '@coworker/core/db/queries/volumes';
import { AppError } from '@coworker/shared';
import { pause_e2b_sandbox } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import { stop_e2b_volume_sandbox } from '@runtime-platform/orchestrator/e2b_volume_sandbox_stop';
import type { CodingWorkspaceCloseToken } from '@runtime-platform/orchestrator/workspace_runtime';
import { read_volume_id, read_volume_provider } from '@runtime-platform/storage/volume_metadata';

const exec_file = promisify(execFile);

export type CloseCodingWorkspaceInput = {
  runtime_environment_id: string;
  workspace_id: string;
  close_token?: CodingWorkspaceCloseToken;
  actor_id: string;
};

export type RuntimeEnvironment = NonNullable<Awaited<ReturnType<typeof get_runtime_environment>>>;

export type ClosedRuntimeEnvironmentCompute = {
  volume_synced?: boolean;
};

export async function reap_runtime_environment_compute(
  db: Database,
  input: CloseCodingWorkspaceInput,
): Promise<ClosedRuntimeEnvironmentCompute> {
  const environment = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  if (!environment) return {};
  assert_workspace_close_token(environment, input.close_token);
  const provider_environment_id =
    input.close_token?.provider_environment_id ?? environment.provider_environment_id;

  if (environment.environment_provider === 'docker' && provider_environment_id) {
    await stop_docker_workspace(provider_environment_id);
  }
  let e2b_volume_synced = false;
  if (environment.environment_provider === 'e2b' && provider_environment_id) {
    e2b_volume_synced = await stop_e2b_workspace(db, environment, provider_environment_id, input);
  }

  const volume_provider = read_volume_provider(environment.environment_metadata);
  return {
    volume_synced:
      environment.environment_provider !== 'e2b' ||
      (volume_provider === 'archil' && e2b_volume_synced),
  };
}

async function stop_docker_workspace(provider_environment_id: string) {
  try {
    await exec_file('docker', ['stop', '--time', '10', provider_environment_id]);
    await exec_file('docker', ['rm', '-f', provider_environment_id]);
  } catch (error) {
    throw error instanceof Error
      ? new Error(`docker reap failed for ${provider_environment_id}: ${error.message}`)
      : error;
  }
}

async function stop_e2b_workspace(
  db: Database,
  environment: RuntimeEnvironment,
  provider_environment_id: string,
  input: CloseCodingWorkspaceInput,
) {
  const volume_provider = read_volume_provider(environment.environment_metadata);
  const sandbox_closed = await e2b_sandbox_is_closed(
    db,
    environment,
    provider_environment_id,
    volume_provider,
    input,
  );
  if (sandbox_closed) return volume_provider === 'archil';
  let volume_synced = false;
  let sandbox_kept = false;
  if (volume_provider === 'archil') {
    ({ volume_synced, sandbox_kept } = await stop_e2b_volume_sandbox(
      db,
      environment,
      provider_environment_id,
    ));
    if (volume_synced) {
      const volume_id = read_volume_id(environment.environment_metadata);
      if (volume_id) {
        await record_volume_synced(db, {
          workspace_id: input.workspace_id,
          volume_id,
          actor_id: input.actor_id,
        }).catch(() => undefined);
      }
    }
  } else {
    await pause_e2b_sandbox(provider_environment_id);
    sandbox_kept = true;
  }
  await mark_e2b_sandbox_closed(db, environment, volume_provider, input, sandbox_kept);
  return volume_synced;
}

async function e2b_sandbox_is_closed(
  db: Database,
  environment: RuntimeEnvironment,
  provider_environment_id: string,
  volume_provider: 'archil' | null,
  input: CloseCodingWorkspaceInput,
) {
  if (!environment.workspace_mount_key) return false;
  const sandbox = await find_sandbox_by_mount_key(db, {
    workspace_id: input.workspace_id,
    sandbox_provider: 'e2b',
    workspace_mount_key: environment.workspace_mount_key,
  });
  const closed_statuses =
    volume_provider === 'archil' ? new Set(['stopped', 'paused']) : new Set(['paused']);
  return (
    sandbox?.provider_sandbox_id === provider_environment_id &&
    closed_statuses.has(sandbox.sandbox_status)
  );
}

async function mark_e2b_sandbox_closed(
  db: Database,
  environment: RuntimeEnvironment,
  volume_provider: 'archil' | null,
  input: CloseCodingWorkspaceInput,
  sandbox_kept: boolean,
) {
  if (!environment.workspace_mount_key) return;
  const sandbox = await find_sandbox_by_mount_key(db, {
    workspace_id: input.workspace_id,
    sandbox_provider: 'e2b',
    workspace_mount_key: environment.workspace_mount_key,
  });
  if (!sandbox) return;
  if (
    input.close_token?.provider_environment_id &&
    sandbox.provider_sandbox_id !== input.close_token.provider_environment_id
  ) {
    throw stale_workspace_close_error();
  }
  await update_sandbox_state(db, {
    sandbox_id: sandbox.sandbox_id,
    sandbox_status: sandbox_kept ? 'paused' : 'stopped',
    actor_id: input.actor_id,
  });
}

export async function publish_closed_runtime_environment(
  db: Database,
  input: {
    runtime_environment_id: string;
    environment_status: 'idle' | 'failed';
    merge_environment_metadata?: Record<string, unknown>;
    close_result: ClosedRuntimeEnvironmentCompute;
    actor_id: string;
  },
) {
  return update_runtime_environment_state(db, {
    runtime_environment_id: input.runtime_environment_id,
    environment_status: input.environment_status,
    ...(input.merge_environment_metadata
      ? { merge_environment_metadata: input.merge_environment_metadata }
      : {}),
    actor_id: input.actor_id,
  });
}

export async function find_replayed_workspace_close(
  db: Database,
  input: CloseCodingWorkspaceInput,
) {
  const environment = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  if (!environment || !['idle', 'failed'].includes(environment.environment_status)) return null;
  assert_workspace_close_token(environment, input.close_token);
  return environment;
}

export async function claim_workspace_close(db: Database, input: CloseCodingWorkspaceInput) {
  const environment = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  if (!environment) return { claimed: true as const, environment: null };
  assert_workspace_close_token(environment, input.close_token);

  const claimed = await claim_runtime_environment_close(db, input);
  if (claimed) return { claimed: true as const, environment: claimed };
  const current = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  return { claimed: false as const, environment: current ?? environment };
}

function assert_workspace_close_token(
  environment: Awaited<ReturnType<typeof get_runtime_environment>> & {},
  close_token: CodingWorkspaceCloseToken | undefined,
) {
  if (
    close_token?.provider_environment_id &&
    environment.provider_environment_id !== close_token.provider_environment_id
  ) {
    throw stale_workspace_close_error();
  }
}

function stale_workspace_close_error() {
  return new AppError(
    'stale_workspace_close',
    'This run no longer owns the workspace sandbox.',
    409,
  );
}
