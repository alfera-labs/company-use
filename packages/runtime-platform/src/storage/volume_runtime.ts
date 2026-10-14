import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { find_volume, volume_root_path } from '@coworker/core/db/queries/volumes';
import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import { AppError, create_logger, format_error_message } from '@coworker/shared';
import { provision_volume } from '@runtime-platform/storage/volume_provisioner';

const log = create_logger('volume_runtime');

export const volume_sandbox_lifetime_ms = 60 * 60 * 1000;

export type OpenVolume = {
  volume_id: string;
  workspace_mount_key: string;
  provider: 'archil';
  provider_volume_id: string;
  provider_region?: string;
  root_path: string;
  workspace_layout_version: number;
  mount_token: string;
};

type Volume = NonNullable<Awaited<ReturnType<typeof find_volume>>>;

export async function open_volume(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    compute_provider: 'local' | 'docker' | 'e2b';
    enabled?: boolean;
    actor_id: string;
  },
): Promise<OpenVolume | null> {
  if (!volume_is_enabled(input)) return null;
  const volume =
    (await find_volume(db, input.workspace_id)) ?? (await provision_missing_volume(db, input));

  assert_volume_mountable(volume);
  const mount_token = read_archil_mount_token(volume);
  return opened_volume(volume, input.session_id, mount_token);
}

async function provision_missing_volume(
  db: Database,
  input: { workspace_id: string; actor_id: string },
): Promise<Volume> {
  try {
    return await provision_volume(db, {
      workspace_id: input.workspace_id,
      actor_id: input.actor_id,
    });
  } catch (error) {
    log.error('Volume provisioning failed at run start; durable storage is unavailable.', {
      workspace_id: input.workspace_id,
      error: format_error_message(error),
    });
    throw new AppError(
      'durable_storage_unavailable',
      'Durable workspace storage is unavailable right now. Please retry shortly.',
      503,
    );
  }
}

function volume_is_enabled(input: {
  enabled?: boolean;
  compute_provider: 'local' | 'docker' | 'e2b';
}) {
  return (
    (input.enabled ?? env.COWORKER_PERSISTENT_WORKSPACES_ENABLED) &&
    input.compute_provider === 'e2b'
  );
}

function assert_volume_mountable(volume: Volume): asserts volume is Volume & {
  provider_volume_id: string;
} {
  if (volume.volume_status !== 'active' || !volume.provider_volume_id) {
    throw new AppError('volume_not_active', `Volume is ${volume.volume_status}.`, 409);
  }
}

function read_archil_mount_token(volume: Volume) {
  const mount_token = read_connection_credential_value(
    volume.encrypted_mount_credentials,
    'mount_token',
  );
  if (!mount_token) {
    throw new AppError(
      'volume_mount_token_missing',
      'The volume has no usable Archil mount token.',
      500,
    );
  }
  return mount_token;
}

function opened_volume(
  volume: Volume & { provider_volume_id: string },
  session_id: string,
  mount_token: string,
): OpenVolume {
  return {
    volume_id: volume.volume_id,
    workspace_mount_key: volume_mount_key(volume.workspace_id, session_id),
    provider: 'archil',
    provider_volume_id: volume.provider_volume_id,
    ...(volume.provider_region ? { provider_region: volume.provider_region } : {}),
    root_path: volume_root_path,
    workspace_layout_version: volume.volume_config.workspace_layout_version ?? 1,
    mount_token,
  };
}

export function volume_mount_key(workspace_id: string, session_id: string) {
  return `workspace:${workspace_id}:${session_id}`;
}
