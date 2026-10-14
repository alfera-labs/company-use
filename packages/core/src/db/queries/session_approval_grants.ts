import type { Database } from '@coworker/core/db/connection';
import { unchanged_lifecycle_columns } from '@coworker/core/db/schema/common';
import { sessions } from '@coworker/core/db/schema/core';
import type {
  SessionApprovalGrant,
  SessionMetadata,
} from '@coworker/core/db/schema/json_column_types';
import { and, eq, sql } from 'drizzle-orm';

export function session_approval_grants(metadata: SessionMetadata): ReadonlySet<string> {
  return new Set((metadata.approval_grants ?? []).map((grant) => grant.node_key));
}

export async function add_session_approval_grants(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    node_keys: readonly string[];
    granted_by: string;
  },
): Promise<SessionApprovalGrant[]> {
  const granted_time = new Date().toISOString();
  const grants: SessionApprovalGrant[] = [...new Set(input.node_keys)].map((node_key) => ({
    node_key,
    granted_by: input.granted_by,
    granted_time,
  }));
  if (grants.length === 0) return [];

  await db
    .update(sessions)
    .set({
      // The same tool granted twice appends twice. The reader dedupes and the list is
      // a handful of rows per chat; rewrite as a filtered concat if a chat ever grows a long one.
      session_metadata: sql`${sessions.session_metadata} || jsonb_build_object(
        'approval_grants',
        COALESCE(${sessions.session_metadata} -> 'approval_grants', '[]'::jsonb)
          || ${JSON.stringify(grants)}::jsonb
      )`,
      ...unchanged_lifecycle_columns(sessions),
    })
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    );

  return grants;
}
