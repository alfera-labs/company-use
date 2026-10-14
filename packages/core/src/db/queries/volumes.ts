import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { volumes } from '@coworker/core/db/schema';
import { create_id, id_prefixes, NotFoundError, resolve_volume_config } from '@coworker/shared';
import { and, eq, lte } from 'drizzle-orm';

export const volume_root_path = '/mnt/coworker';
const volume_provisioning_timeout_ms = 5 * 60 * 1000;

export async function find_volume(db: Database, workspace_id: string) {
  return (
    (await db.query.volumes.findFirst({
      where: eq(volumes.workspace_id, workspace_id),
    })) ?? null
  );
}

export async function get_volume(db: Database, input: { workspace_id: string; volume_id: string }) {
  return (
    (await db.query.volumes.findFirst({
      where: and(
        eq(volumes.workspace_id, input.workspace_id),
        eq(volumes.volume_id, input.volume_id),
      ),
    })) ?? null
  );
}

export async function record_volume_synced(
  db: Database,
  input: { workspace_id: string; volume_id: string; actor_id: string },
) {
  const now = new Date();
  await db
    .update(volumes)
    .set({ last_synced_time: now, last_updated_time: now, last_updated_by: input.actor_id })
    .where(
      and(eq(volumes.workspace_id, input.workspace_id), eq(volumes.volume_id, input.volume_id)),
    );
}

export async function create_volume(
  db: Database,
  input: {
    volume_id?: string;
    workspace_id: string;
    volume_provider: 'archil';
    volume_status?: 'provisioning' | 'retryable' | 'active';
    provider_volume_id?: string | null;
    provider_region?: string | null;
    encrypted_mount_credentials?: Record<string, unknown> | null;
    workspace_layout_version: number;
    actor_id: string;
  },
) {
  const volume_id = input.volume_id ?? create_id(id_prefixes.volume);
  const [volume] = await db
    .insert(volumes)
    .values({
      volume_id,
      workspace_id: input.workspace_id,
      volume_provider: input.volume_provider,
      volume_status: input.volume_status ?? 'provisioning',
      provider_volume_id: input.provider_volume_id ?? null,
      provider_region: input.provider_region ?? null,
      volume_config: resolve_volume_config({
        volume_id,
        workspace_id: input.workspace_id,
        workspace_layout_version: input.workspace_layout_version,
      }),
      encrypted_mount_credentials: input.encrypted_mount_credentials ?? null,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(volume, 'Volume');
}

export async function claim_volume_provisioning(
  db: Database,
  input: {
    volume_id: string;
    workspace_id: string;
    provider_region: string;
    workspace_layout_version: number;
    actor_id: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [created] = await db
    .insert(volumes)
    .values({
      volume_id: input.volume_id,
      workspace_id: input.workspace_id,
      volume_provider: 'archil',
      volume_status: 'provisioning',
      provider_region: input.provider_region,
      volume_config: resolve_volume_config({
        volume_id: input.volume_id,
        workspace_id: input.workspace_id,
        workspace_layout_version: input.workspace_layout_version,
      }),
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .onConflictDoNothing({ target: volumes.workspace_id })
    .returning();
  if (created) return { volume: created, claimed: true as const };

  const existing = await find_volume(db, input.workspace_id);
  if (!existing) {
    return { volume: existing, claimed: false as const };
  }

  if (existing.volume_status === 'retryable') {
    const [claimed] = await db
      .update(volumes)
      .set({
        volume_status: 'provisioning',
        provider_region: input.provider_region,
        provider_volume_id: null,
        encrypted_mount_credentials: null,
        last_updated_time: now,
        last_updated_by: input.actor_id,
      })
      .where(and(eq(volumes.volume_id, existing.volume_id), eq(volumes.volume_status, 'retryable')))
      .returning();
    return { volume: claimed ?? existing, claimed: Boolean(claimed) };
  }

  if (existing.volume_status !== 'provisioning') {
    return { volume: existing, claimed: false as const };
  }

  const stale_before = new Date(now.getTime() - volume_provisioning_timeout_ms);
  const [claimed] = await db
    .update(volumes)
    .set({
      provider_region: input.provider_region,
      last_updated_time: now,
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(volumes.volume_id, existing.volume_id),
        eq(volumes.volume_status, 'provisioning'),
        lte(volumes.last_updated_time, stale_before),
      ),
    )
    .returning();
  return { volume: claimed ?? existing, claimed: Boolean(claimed) };
}

export async function set_volume_provider_identity(
  db: Database,
  input: {
    volume_id: string;
    provider_volume_id: string;
    provider_region: string;
    actor_id: string;
  },
) {
  const [volume] = await db
    .update(volumes)
    .set({
      provider_volume_id: input.provider_volume_id,
      provider_region: input.provider_region,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(volumes.volume_id, input.volume_id), eq(volumes.volume_status, 'provisioning')))
    .returning();
  if (!volume) throw new NotFoundError('Provisioning volume');
  return volume;
}

export async function activate_volume(
  db: Database,
  input: {
    volume_id: string;
    provider_volume_id: string;
    provider_region?: string | null;
    encrypted_mount_credentials?: Record<string, unknown> | null;
    actor_id: string;
  },
) {
  const [volume] = await db
    .update(volumes)
    .set({
      volume_status: 'active',
      provider_volume_id: input.provider_volume_id,
      ...(input.provider_region === undefined ? {} : { provider_region: input.provider_region }),
      ...(input.encrypted_mount_credentials === undefined
        ? {}
        : { encrypted_mount_credentials: input.encrypted_mount_credentials }),
      last_error_code: null,
      last_error_message: null,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(volumes.volume_id, input.volume_id))
    .returning();

  if (!volume) throw new NotFoundError('Volume');
  return volume;
}

export async function mark_volume_unhealthy(
  db: Database,
  input: {
    volume_id: string;
    error_code: string;
    error_message: string;
    actor_id: string;
    provider_volume_id?: string;
  },
) {
  const [volume] = await db
    .update(volumes)
    .set({
      volume_status: 'unhealthy',
      last_error_code: input.error_code,
      last_error_message: input.error_message,
      ...(input.provider_volume_id === undefined
        ? {}
        : { provider_volume_id: input.provider_volume_id }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(volumes.volume_id, input.volume_id))
    .returning();

  if (!volume) throw new NotFoundError('Volume');
  return volume;
}

export async function mark_volume_retryable(
  db: Database,
  input: {
    volume_id: string;
    error_code: string;
    error_message: string;
    actor_id: string;
  },
) {
  const [volume] = await db
    .update(volumes)
    .set({
      volume_status: 'retryable',
      provider_volume_id: null,
      encrypted_mount_credentials: null,
      last_error_code: input.error_code,
      last_error_message: input.error_message,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(volumes.volume_id, input.volume_id), eq(volumes.volume_status, 'provisioning')))
    .returning();

  if (!volume) throw new NotFoundError('Provisioning volume');
  return volume;
}
