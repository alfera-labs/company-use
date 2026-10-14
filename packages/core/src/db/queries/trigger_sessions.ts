import type { Database } from '@coworker/core/db/connection';
import { find_or_create_session_for_external_thread } from '@coworker/core/db/queries/sessions';
import { unchanged_lifecycle_columns } from '@coworker/core/db/schema/common';
import { sessions } from '@coworker/core/db/schema/core';
import { and, eq, sql } from 'drizzle-orm';

const trigger_session_source = 'trigger';

type TriggerSessionInput = {
  workspace_id: string;
  agent_id: string;
  external_thread_key: string;
  session_title: string;
  source_metadata: Record<string, unknown>;
  actor_id: string;
  project_id?: string;
};

/** Finds the chat a trigger continues, or starts one. A deleted chat counts as no chat yet. */
export async function find_or_create_trigger_session(db: Database, input: TriggerSessionInput) {
  await release_thread_of_deleted_trigger_session(db, input);
  return find_or_create_session_for_external_thread(db, {
    ...input,
    session_source: trigger_session_source,
  });
}

async function release_thread_of_deleted_trigger_session(db: Database, input: TriggerSessionInput) {
  await db
    .update(sessions)
    .set({
      external_thread_key: null,
      metadata: sql`${sessions.metadata} || jsonb_build_object(
        'external_thread_key_before_delete', ${input.external_thread_key}::text
      )`,
      ...unchanged_lifecycle_columns(sessions),
    })
    .where(
      and(
        eq(sessions.workspace_id, input.workspace_id),
        eq(sessions.agent_id, input.agent_id),
        eq(sessions.session_source, trigger_session_source),
        eq(sessions.external_thread_key, input.external_thread_key),
        eq(sessions.session_status, 'deleted'),
      ),
    );
}
