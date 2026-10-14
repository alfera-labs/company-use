import type { Database } from '@coworker/core';
import {
  activate_volume,
  claim_volume_provisioning,
  find_volume,
  mark_volume_retryable,
  mark_volume_unhealthy,
  set_volume_provider_identity,
} from '@coworker/core/db/queries/volumes';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import {
  AppError,
  create_id,
  format_error_message,
  id_prefixes,
  read_volume_storage_path,
} from '@coworker/shared';
import {
  type ArchilVolumeConfig,
  archil_r2_mount,
  read_archil_volume_config,
} from '@runtime-platform/storage/archil_volume_config';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { Archil, ArchilApiError, type R2Mount } from 'disk';

type ArchilProvisioningClient = {
  disks: {
    create(input: { name: string; mounts: R2Mount[]; authMethods: [] }): Promise<{
      disk: ArchilProvisioningDisk;
      authorizedUsers?: ArchilAuthorizedUser[];
    }>;
    get(provider_volume_id: string): Promise<ArchilProvisioningDisk>;
    list(input: { name: string }): Promise<ArchilProvisioningDisk[]>;
  };
};

type ArchilAuthorizedUser = {
  type?: 'token' | 'awssts';
  identifier?: string;
};

type ArchilProvisioningDisk = {
  id: string;
  name: string;
  authorizedUsers?: ArchilAuthorizedUser[];
  createToken(nickname: string): Promise<{ token: string }>;
  removeTokenUser(identifier: string): Promise<void>;
  delete(): Promise<void>;
};

export async function provision_volume(
  db: Database,
  input: { workspace_id: string; actor_id: string },
  create_archil_client: (config: { apiKey: string; region: string }) => ArchilProvisioningClient = (
    config,
  ) => new Archil(config),
) {
  const existing = await find_volume(db, input.workspace_id);
  if (existing?.volume_status === 'active') return existing;
  if (
    existing &&
    existing.volume_status !== 'provisioning' &&
    existing.volume_status !== 'retryable'
  ) {
    throw inactive_volume_error(existing.volume_status);
  }

  const config = read_archil_volume_config();
  const volume_id = create_id(id_prefixes.volume);
  const provisioning = await claim_volume_provisioning(db, {
    volume_id,
    workspace_id: input.workspace_id,
    provider_region: config.region,
    workspace_layout_version: current_workspace_layout.layout_version,
    actor_id: input.actor_id,
  });
  if (!provisioning.volume) throw new Error('Volume provisioning claim was not found.');
  if (provisioning.volume.volume_status === 'active') return provisioning.volume;
  if (provisioning.volume.volume_status !== 'provisioning') {
    throw inactive_volume_error(provisioning.volume.volume_status);
  }
  if (!provisioning.claimed) throw volume_provisioning_in_progress_error();
  const archil = create_archil_client({ apiKey: config.api_key, region: config.region });
  return create_archil_volume(db, {
    archil,
    config,
    volume: provisioning.volume,
    actor_id: input.actor_id,
  });
}

async function create_archil_volume(
  db: Database,
  input: {
    archil: ArchilProvisioningClient;
    config: ArchilVolumeConfig;
    volume: NonNullable<Awaited<ReturnType<typeof find_volume>>>;
    actor_id: string;
  },
) {
  let disk: ArchilProvisioningDisk | undefined;
  try {
    disk = await find_or_create_archil_disk(input);
    await set_volume_provider_identity(db, {
      volume_id: input.volume.volume_id,
      provider_volume_id: disk.id,
      provider_region: input.config.region,
      actor_id: input.actor_id,
    });
    const mount_token = await replace_archil_mount_token(disk);
    return activate_volume(db, {
      volume_id: input.volume.volume_id,
      provider_volume_id: disk.id,
      provider_region: input.config.region,
      encrypted_mount_credentials: encrypted_archil_mount_credentials(disk.id, mount_token),
      actor_id: input.actor_id,
    });
  } catch (error) {
    return record_archil_provisioning_failure(db, input.volume, disk, error, input.actor_id);
  }
}

async function find_or_create_archil_disk(input: {
  archil: ArchilProvisioningClient;
  config: ArchilVolumeConfig;
  volume: NonNullable<Awaited<ReturnType<typeof find_volume>>>;
}) {
  if (input.volume.provider_volume_id) {
    return input.archil.disks.get(input.volume.provider_volume_id);
  }
  const existing = await find_archil_disk_by_name(input.archil, input.volume.volume_id);
  if (existing) return existing;
  const created = await input.archil.disks.create({
    name: archil_disk_name(input.volume.volume_id),
    mounts: [archil_r2_mount(input.config, read_volume_storage_path(input.volume))],
    authMethods: [],
  });
  return created.disk;
}

async function find_archil_disk_by_name(archil: ArchilProvisioningClient, volume_id: string) {
  const name = archil_disk_name(volume_id);
  const matches = (await archil.disks.list({ name })).filter((disk) => disk.name === name);
  if (matches.length > 1) throw new Error(`Archil returned multiple disks named ${name}.`);
  return matches[0];
}

async function replace_archil_mount_token(disk: ArchilProvisioningDisk) {
  const token_users = (disk.authorizedUsers ?? []).filter(
    (user): user is ArchilAuthorizedUser & { identifier: string } =>
      user.type === 'token' && typeof user.identifier === 'string',
  );
  await Promise.all(token_users.map((user) => disk.removeTokenUser(user.identifier)));
  const created = await disk.createToken('coworker-runtime');
  if (!created.token) throw new Error('Archil did not return a disk mount token.');
  return created.token;
}

function encrypted_archil_mount_credentials(provider_volume_id: string, mount_token: string) {
  return encrypt_connection_credentials({
    credential_source: 'archil_disk_mount',
    values: { mount_token },
    metadata: { provider_volume_id },
  });
}

async function record_archil_provisioning_failure(
  db: Database,
  volume: NonNullable<Awaited<ReturnType<typeof find_volume>>>,
  disk: ArchilProvisioningDisk | undefined,
  error: unknown,
  actor_id: string,
): Promise<never> {
  const cleanup_error = await delete_failed_archil_disk(disk);
  const failure = archil_provisioning_error(error, cleanup_error);
  if (cleanup_error) {
    await mark_volume_unhealthy(db, {
      volume_id: volume.volume_id,
      error_code: failure.error_code,
      error_message: failure.error_message,
      ...(disk ? { provider_volume_id: disk.id } : {}),
      actor_id,
    });
  } else {
    await mark_volume_retryable(db, {
      volume_id: volume.volume_id,
      error_code: failure.error_code,
      error_message: failure.error_message,
      actor_id,
    });
  }
  throw new AppError(
    failure.error_code,
    'Persistent workspace provisioning failed. Please try again or contact support.',
    502,
  );
}

function inactive_volume_error(status: string) {
  return new AppError('volume_not_active', `Volume is ${status}.`, 409);
}

function volume_provisioning_in_progress_error() {
  return new AppError(
    'volume_provisioning_in_progress',
    'Persistent workspace provisioning is already in progress. Please try again shortly.',
    409,
  );
}

function archil_disk_name(volume_id: string) {
  return `coworker-${volume_id.replaceAll('_', '-')}`;
}

async function delete_failed_archil_disk(disk: ArchilProvisioningDisk | undefined) {
  if (!disk) return undefined;
  try {
    await disk.delete();
    return undefined;
  } catch (error) {
    return error;
  }
}

function archil_provisioning_error(error: unknown, cleanup_error?: unknown) {
  const cleanup_message = cleanup_error
    ? ` Provider cleanup also failed: ${format_error_message(cleanup_error)}`
    : '';
  if (error instanceof ArchilApiError) {
    return {
      error_code: cleanup_error
        ? 'archil_provisioning_cleanup_failed'
        : 'archil_provisioning_failed',
      error_message: `Archil provisioning failed (${error.status}): ${error.message}${cleanup_message}`,
    };
  }
  return {
    error_code: cleanup_error ? 'archil_provisioning_cleanup_failed' : 'archil_provisioning_failed',
    error_message: `${format_error_message(error)}${cleanup_message}`,
  };
}
