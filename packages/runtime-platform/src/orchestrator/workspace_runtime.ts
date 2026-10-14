import type { SessionEnv } from '@agent-core/environment';
import type { Database } from '@coworker/core';
import {
  update_runtime_environment_state,
  update_sandbox_state,
} from '@coworker/core/db/queries/sessions';
import { AppError, create_logger, format_error_message } from '@coworker/shared';
import { create_browser_state_config } from '@runtime-platform/browser/browser_state_config';
import { create_deferred_session_env } from '@runtime-platform/orchestrator/deferred_session_env';
import {
  e2b_planned_session_env,
  stop_e2b_sandbox,
} from '@runtime-platform/orchestrator/e2b_sandbox_client';
import { E2bVolumeError } from '@runtime-platform/orchestrator/e2b_volume';
import { wait_for_workspace_close_work } from '@runtime-platform/orchestrator/workspace_close_queue';
import {
  create_workspace_environment,
  workspace_credential_headers,
} from '@runtime-platform/orchestrator/workspace_environment_providers';
import {
  find_or_create_e2b_sandbox,
  find_or_create_runtime_environment,
} from '@runtime-platform/orchestrator/workspace_environment_records';
import { default_workspace_runtime_provider } from '@runtime-platform/orchestrator/workspace_host_paths';
import {
  locate_coding_workspace,
  type WorkspaceLocation,
} from '@runtime-platform/orchestrator/workspace_location';
import { volume_metadata } from '@runtime-platform/storage/volume_metadata';
import { type OpenVolume, open_volume } from '@runtime-platform/storage/volume_runtime';
import {
  current_workspace_layout,
  volume_workspace_path,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';

export {
  mark_coding_workspace_failed,
  mark_coding_workspace_idle,
} from '@runtime-platform/orchestrator/workspace_close_transitions';
export {
  default_workspace_runtime_provider,
  workspace_directories,
  workspace_directories_for_layout,
} from '@runtime-platform/orchestrator/workspace_host_paths';

const log = create_logger('workspace_runtime');

export type WorkspaceRuntimeProvider = 'local' | 'docker' | 'e2b';

export type OpenedCodingWorkspace = {
  runtime_environment_id: string;
  workspace_id: string;
  workspace_mount_key: string;
  provider: WorkspaceRuntimeProvider;
  host_workspace_root: string;
  environment: SessionEnv;
  volume?: OpenVolume;
  durable_storage_unavailable?: boolean;
  close_token: CodingWorkspaceCloseToken;
  attaching?: Promise<OpenedCodingWorkspace>;
};

export type CodingWorkspaceCloseToken = {
  provider_environment_id?: string;
};

export type OpenCodingWorkspaceInput = {
  workspace_id: string;
  session_id: string;
  agent_id: string;
  run_id: string;
  provider?: WorkspaceRuntimeProvider;
  workspace_base_path?: string;
  actor_id: string;
  prepare_attached_environment?: (opened: OpenedCodingWorkspace) => Promise<OpenedCodingWorkspace>;
};

export async function open_or_create_coding_workspace(
  db: Database,
  input: OpenCodingWorkspaceInput,
): Promise<OpenedCodingWorkspace> {
  const provider = input.provider ?? default_workspace_runtime_provider();
  const run_volume = await open_volume_for_run(db, input, provider);
  return start_coding_workspace(db, input, provider, run_volume, () =>
    retry_volume_then_ephemeral(db, input, provider),
  );
}

export async function settled_coding_workspace(
  coding_workspace: OpenedCodingWorkspace,
): Promise<OpenedCodingWorkspace> {
  try {
    return (await coding_workspace.attaching) ?? coding_workspace;
  } catch {
    return coding_workspace;
  }
}

async function retry_volume_then_ephemeral(
  db: Database,
  input: OpenCodingWorkspaceInput,
  provider: WorkspaceRuntimeProvider,
): Promise<OpenedCodingWorkspace> {
  const retry_volume = await open_volume_for_run(db, input, provider);
  const retried = await start_coding_workspace(db, input, provider, retry_volume, () =>
    start_ephemeral_coding_workspace(db, input, provider),
  );
  return settled_coding_workspace(retried);
}

async function start_ephemeral_coding_workspace(
  db: Database,
  input: OpenCodingWorkspaceInput,
  provider: WorkspaceRuntimeProvider,
): Promise<OpenedCodingWorkspace> {
  log.error('Workspace volume could not be attached; run continues on ephemeral compute.', {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
  });
  const ephemeral = await start_coding_workspace(db, input, provider, {
    durable_storage_unavailable: true,
  });
  return settled_coding_workspace(ephemeral);
}

type RunVolume = { volume?: OpenVolume; durable_storage_unavailable?: boolean };

async function open_volume_for_run(
  db: Database,
  input: OpenCodingWorkspaceInput,
  provider: WorkspaceRuntimeProvider,
): Promise<RunVolume> {
  try {
    const volume = await open_volume(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      compute_provider: provider,
      actor_id: input.actor_id,
    });
    return volume ? { volume } : {};
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'durable_storage_unavailable') throw error;
    log.error('Durable storage unavailable; run continues on ephemeral compute.', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
    });
    return { durable_storage_unavailable: true };
  }
}

async function start_coding_workspace(
  db: Database,
  input: OpenCodingWorkspaceInput,
  provider: WorkspaceRuntimeProvider,
  run_volume: RunVolume,
  on_volume_failure?: () => Promise<OpenedCodingWorkspace>,
): Promise<OpenedCodingWorkspace> {
  const volume = run_volume.volume;
  const location = await locate_coding_workspace(input, provider, volume);
  const attach = async () => {
    await wait_for_workspace_close_work(location.workspace_mount_key);
    const records = await create_starting_workspace_records(db, input, provider, location, volume);
    const creation_input = {
      ...environment_creation_input(db, input, location, records.sandbox_record, volume),
      ...(records.browser_sandbox_id ? { browser_sandbox_id: records.browser_sandbox_id } : {}),
      ...(await workspace_credential_headers(db, provider, input.workspace_id)),
    };
    return attach_coding_workspace(
      db,
      input,
      provider,
      records,
      creation_input,
      location,
      run_volume,
      { ...(on_volume_failure ? { on_volume_failure } : {}) },
    );
  };

  if (provider !== 'e2b') return attach();

  const environment_record = await find_or_create_runtime_environment(db, {
    ...input,
    provider,
    ...location,
    ...(volume ? { volume } : {}),
  });

  const attaching = attach();
  attaching.catch((error) =>
    log.error('Workspace sandbox attach failed; the run continues without one.', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      error: format_error_message(error),
    }),
  );
  return {
    runtime_environment_id: environment_record.runtime_environment_id,
    workspace_id: input.workspace_id,
    ...location,
    provider,
    environment: create_deferred_session_env({
      attaching: attaching.then((workspace) => assert_the_plan_held(workspace, volume)),
      planned: e2b_planned_session_env({
        runtime_environment_id: environment_record.runtime_environment_id,
        workspace_mount_key: location.workspace_mount_key,
        host_workspace_root: location.host_workspace_root,
        ...(volume ? { volume } : {}),
      }),
    }),
    close_token: {},
    ...(volume ? { volume } : {}),
    ...(run_volume.durable_storage_unavailable ? { durable_storage_unavailable: true } : {}),
    attaching,
  };
}

function assert_the_plan_held(workspace: OpenedCodingWorkspace, planned_volume?: OpenVolume) {
  if (planned_volume && workspace.durable_storage_unavailable) {
    throw new AppError(
      'durable_storage_unavailable',
      'Durable workspace storage could not be attached for this run, so nothing written now would survive it. Tell the person storage is temporarily down and to retry once it is back.',
      503,
    );
  }
  return workspace.environment;
}

async function attach_coding_workspace(
  db: Database,
  input: OpenCodingWorkspaceInput,
  provider: WorkspaceRuntimeProvider,
  records: Awaited<ReturnType<typeof create_starting_workspace_records>>,
  creation_input: Parameters<typeof create_workspace_environment>[2],
  location: WorkspaceLocation,
  run_volume: RunVolume,
  fallback: { on_volume_failure?: () => Promise<OpenedCodingWorkspace> },
): Promise<OpenedCodingWorkspace> {
  const volume = run_volume.volume;
  let environment: SessionEnv | undefined;
  try {
    environment = await create_workspace_environment(
      provider,
      records.starting_environment.runtime_environment_id,
      creation_input,
    );
    await mark_workspace_records_running(db, records, environment, provider, input.actor_id);
    const workspace = opened_coding_workspace(
      input,
      provider,
      location,
      records,
      environment,
      run_volume,
    );
    return (await input.prepare_attached_environment?.(workspace)) ?? workspace;
  } catch (error) {
    await clean_failed_workspace_start(volume, input.agent_id, environment);
    if (error instanceof E2bVolumeError && fallback.on_volume_failure) {
      return fallback.on_volume_failure();
    }
    throw error;
  }
}

async function create_starting_workspace_records(
  db: Database,
  input: OpenCodingWorkspaceInput,
  provider: WorkspaceRuntimeProvider,
  location: WorkspaceLocation,
  volume: OpenVolume | undefined,
) {
  const runtime_environment = await find_or_create_runtime_environment(db, {
    ...input,
    provider,
    ...location,
    ...(volume ? { volume } : {}),
  });
  const browser_sandbox_id =
    runtime_environment.environment_status === 'running' &&
    runtime_environment.environment_metadata.browser_started === true
      ? runtime_environment.provider_environment_id
      : undefined;
  const starting_environment = await update_runtime_environment_state(db, {
    runtime_environment_id: runtime_environment.runtime_environment_id,
    environment_status: 'starting',
    merge_environment_metadata: {
      host_workspace_root: location.host_workspace_root,
      ...(location.host_scratch_root ? { host_scratch_root: location.host_scratch_root } : {}),
      ...(volume ? volume_metadata(volume, input.agent_id) : {}),
    },
    actor_id: input.actor_id,
  });
  const sandbox_record =
    provider === 'e2b'
      ? await find_or_create_e2b_sandbox(db, {
          ...input,
          runtime_environment_id: starting_environment.runtime_environment_id,
          provider,
          ...location,
          ...(volume ? { volume } : {}),
        })
      : undefined;
  return { starting_environment, sandbox_record, browser_sandbox_id };
}

function environment_creation_input(
  db: Database,
  input: OpenCodingWorkspaceInput,
  location: WorkspaceLocation,
  sandbox_record: Awaited<ReturnType<typeof find_or_create_e2b_sandbox>> | undefined,
  volume: OpenVolume | undefined,
) {
  return {
    ...location,
    ...(sandbox_record?.provider_sandbox_id
      ? { provider_sandbox_id: sandbox_record.provider_sandbox_id }
      : {}),
    ...(sandbox_record
      ? {
          on_sandbox_created: record_started_sandbox(db, sandbox_record.sandbox_id, input.actor_id),
        }
      : {}),
    run_id: input.run_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    ...(volume ? { volume } : {}),
  };
}

function record_started_sandbox(db: Database, sandbox_id: string, actor_id: string) {
  return (provider_sandbox_id: string) =>
    update_sandbox_state(db, {
      sandbox_id,
      sandbox_status: 'starting',
      provider_sandbox_id,
      actor_id,
    }).then(() => undefined);
}

async function mark_workspace_records_running(
  db: Database,
  records: Awaited<ReturnType<typeof create_starting_workspace_records>>,
  environment: SessionEnv,
  provider: WorkspaceRuntimeProvider,
  actor_id: string,
) {
  await update_runtime_environment_state(db, {
    runtime_environment_id: records.starting_environment.runtime_environment_id,
    environment_status: 'running',
    provider_environment_id: String(environment.metadata?.provider_environment_id ?? provider),
    environment_config: environment.metadata ?? {},
    merge_environment_metadata: environment.metadata ?? {},
    actor_id,
  });
  if (!records.sandbox_record) return;
  await update_sandbox_state(db, {
    sandbox_id: records.sandbox_record.sandbox_id,
    sandbox_status: 'running',
    provider_sandbox_id: String(environment.metadata?.provider_sandbox_id ?? ''),
    provider_template_id: String(environment.metadata?.provider_template_id ?? ''),
    sandbox_config: environment.metadata ?? {},
    sandbox_metadata: environment.metadata ?? {},
    actor_id,
  });
}

function opened_coding_workspace(
  input: OpenCodingWorkspaceInput,
  provider: WorkspaceRuntimeProvider,
  location: WorkspaceLocation,
  records: Awaited<ReturnType<typeof create_starting_workspace_records>>,
  environment: SessionEnv,
  run_volume: RunVolume,
): OpenedCodingWorkspace {
  const volume = run_volume.volume;
  const provider_environment_id = environment.metadata?.provider_environment_id;
  return {
    runtime_environment_id: records.starting_environment.runtime_environment_id,
    workspace_id: input.workspace_id,
    ...location,
    provider,
    environment,
    close_token: {
      ...(typeof provider_environment_id === 'string' ? { provider_environment_id } : {}),
    },
    ...(volume ? { volume } : {}),
    ...(run_volume.durable_storage_unavailable ? { durable_storage_unavailable: true } : {}),
  };
}

async function clean_failed_workspace_start(
  volume: OpenVolume | undefined,
  agent_id: string,
  environment: SessionEnv | undefined,
) {
  if (!volume) return;
  const provider_sandbox_id = environment?.metadata?.provider_sandbox_id;
  if (typeof provider_sandbox_id !== 'string' || !provider_sandbox_id) return;
  try {
    await stop_e2b_sandbox({
      provider_sandbox_id,
      archil_root_path: volume.root_path,
      agent_workspace_path: volume_workspace_path(
        agent_id,
        workspace_layout_for_version(volume.workspace_layout_version),
      ),
      workspace_layout_version: volume.workspace_layout_version,
      browser_command_env: create_browser_state_config({
        volume_id: volume.volume_id,
      }).command_env,
    });
  } catch (cleanup_error) {
    log.warn('Could not stop the sandbox of a failed workspace start.', {
      volume_id: volume.volume_id,
      provider_sandbox_id,
      error: format_error_message(cleanup_error),
    });
  }
}
