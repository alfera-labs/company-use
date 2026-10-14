import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { api_keys } from '@coworker/core/db/schema';
import { unchanged_lifecycle_columns, updated_by } from '@coworker/core/db/schema/common';
import { AppError, create_id, id_prefixes } from '@coworker/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

export type ApiKeyScope =
  | 'answers.write'
  | 'memory.read'
  | 'memory.write'
  | 'agents.read'
  | 'agents.write'
  | 'sessions.read'
  | 'sessions.write'
  | 'projects.read'
  | 'automations.read'
  | 'automations.write'
  | 'skills.read'
  | 'usage.read'
  | 'integrations.read'
  | 'workspace.read'
  | 'workspace.write'
  | 'chat.completions';
export type ApiKeyAudience = 'internal' | 'external';

export type ApiKey = {
  api_key_id: string;
  workspace_id: string;
  key_prefix: string;
  key_name: string;
  scopes: ApiKeyScope[];
  key_audience: ApiKeyAudience;
  key_status: 'active' | 'revoked' | 'expired';
  last_used_time: Date | null;
  expires_time: Date | null;
  revoked_time: Date | null;
  created_time: Date;
  created_by: string;
};

export async function create_api_key(
  db: Database,
  input: {
    workspace_id: string;
    key_name: string;
    scopes: ApiKeyScope[];
    key_audience: ApiKeyAudience;
    environment_label: 'live' | 'test';
    expires_time?: Date;
    actor_id: string;
  },
): Promise<{ api_key: ApiKey; secret: string }> {
  const secret = generate_api_key_secret(input.environment_label);
  const [row] = await db
    .insert(api_keys)
    .values({
      api_key_id: create_id(id_prefixes.api_key),
      workspace_id: input.workspace_id,
      key_hash: hash_api_key_secret(secret),
      key_prefix: secret.slice(0, 12),
      key_name: input.key_name,
      scopes: input.scopes,
      key_audience: input.key_audience,
      expires_time: input.expires_time ?? null,
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();
  return { api_key: project_api_key(require_inserted_row(row, 'API key')), secret };
}

export async function find_live_api_key_by_secret(
  db: Database,
  presented_secret: string,
): Promise<ApiKey> {
  const [row] = await db
    .select()
    .from(api_keys)
    .where(eq(api_keys.key_hash, hash_api_key_secret(presented_secret)));
  if (!row) throw new AppError('api_key_invalid', 'This API key is not valid', 401);
  const key = project_api_key(row);
  if (key.key_status === 'revoked') {
    throw new AppError('api_key_revoked', 'This API key was revoked', 401);
  }
  if (key.key_status === 'expired') {
    throw new AppError('api_key_expired', 'This API key expired. Create a new one.', 401);
  }
  return key;
}

export async function find_live_api_key_by_name(
  db: Database,
  input: { workspace_id: string; key_name: string },
): Promise<ApiKey | null> {
  const rows = await db
    .select()
    .from(api_keys)
    .where(
      and(eq(api_keys.workspace_id, input.workspace_id), eq(api_keys.key_name, input.key_name)),
    )
    .orderBy(desc(api_keys.created_time));
  const live = rows.map(project_api_key).find((key) => key.key_status === 'active');
  return live ?? null;
}

export async function find_api_key_by_id(db: Database, api_key_id: string): Promise<ApiKey | null> {
  const [row] = await db.select().from(api_keys).where(eq(api_keys.api_key_id, api_key_id));
  return row ? project_api_key(row) : null;
}

export async function list_workspace_api_keys(
  db: Database,
  workspace_id: string,
): Promise<ApiKey[]> {
  const rows = await db
    .select()
    .from(api_keys)
    .where(eq(api_keys.workspace_id, workspace_id))
    .orderBy(desc(api_keys.created_time));
  return rows.map(project_api_key);
}

export async function revoke_api_key(
  db: Database,
  input: { workspace_id: string; api_key_id: string; actor_id: string },
): Promise<ApiKey | null> {
  const [row] = await db
    .update(api_keys)
    .set({ revoked_time: sql`now()`, ...updated_by(input.actor_id) })
    .where(
      and(
        eq(api_keys.workspace_id, input.workspace_id),
        eq(api_keys.api_key_id, input.api_key_id),
        isNull(api_keys.revoked_time),
      ),
    )
    .returning();
  return row ? project_api_key(row) : null;
}

export async function count_api_key_request_in_window(
  db: Database,
  input: { api_key_id: string; window_ms: number; request_limit: number },
): Promise<{ allowed: boolean; request_count: number }> {
  const window_floor = new Date(Math.floor(Date.now() / input.window_ms) * input.window_ms);
  const window_rolled = sql`(${api_keys.rate_window_start_time} IS NULL OR ${api_keys.rate_window_start_time} < ${window_floor.toISOString()}::timestamptz)`;
  const [row] = await db
    .update(api_keys)
    .set({
      rate_window_start_time: sql`CASE WHEN ${window_rolled} THEN ${window_floor.toISOString()}::timestamptz ELSE ${api_keys.rate_window_start_time} END`,
      rate_window_request_count: sql`CASE WHEN ${window_rolled} THEN 1 ELSE ${api_keys.rate_window_request_count} + 1 END`,
      last_used_time: sql`now()`,
      ...unchanged_lifecycle_columns(api_keys),
    })
    .where(eq(api_keys.api_key_id, input.api_key_id))
    .returning({ request_count: api_keys.rate_window_request_count });
  const request_count = row?.request_count ?? 1;
  return { allowed: request_count <= input.request_limit, request_count };
}

function project_api_key(row: typeof api_keys.$inferSelect): ApiKey {
  return {
    api_key_id: row.api_key_id,
    workspace_id: row.workspace_id,
    key_prefix: row.key_prefix,
    key_name: row.key_name,
    scopes: row.scopes as ApiKeyScope[],
    key_audience: row.key_audience as ApiKeyAudience,
    key_status: row.revoked_time
      ? 'revoked'
      : row.expires_time && row.expires_time.getTime() < Date.now()
        ? 'expired'
        : 'active',
    last_used_time: row.last_used_time,
    expires_time: row.expires_time,
    revoked_time: row.revoked_time,
    created_time: row.created_time,
    created_by: row.created_by,
  };
}

function generate_api_key_secret(environment_label: 'live' | 'test') {
  return `ak_${environment_label}_${randomBytes(32).toString('base64url')}`;
}

function hash_api_key_secret(secret: string) {
  return createHash('sha256').update(secret).digest('base64url');
}
