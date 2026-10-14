import type { Database } from '@coworker/core';
import { sessions } from '@coworker/core/db/schema';
import { unchanged_lifecycle_columns } from '@coworker/core/db/schema/common';
import { and, eq, ne, sql } from 'drizzle-orm';

export const automation_session_source = 'trigger';

export type AutomationSubjectState = {
  human_took_over_time?: string;
  resolved_time?: string;
  last_customer_message_time?: string;
};

export function read_automation_subject_state(session: {
  session_metadata: Record<string, unknown>;
}): AutomationSubjectState {
  const state = session.session_metadata.automation_subject;
  return typeof state === 'object' && state !== null ? (state as AutomationSubjectState) : {};
}

export async function mark_automation_subject_human_took_over(
  db: Database,
  input: { workspace_id: string; session_id: string; taken_over_time?: Date },
) {
  const taken_over_time = (input.taken_over_time ?? new Date()).toISOString();
  await merge_automation_subject_state(db, input, { human_took_over_time: taken_over_time });
}

export async function mark_automation_subject_customer_wrote_again(
  db: Database,
  input: { workspace_id: string; session_id: string; message_time?: Date },
) {
  const message_time = (input.message_time ?? new Date()).toISOString();
  await merge_automation_subject_state(db, input, { last_customer_message_time: message_time });
}

async function merge_automation_subject_state(
  db: Database,
  input: { workspace_id: string; session_id: string },
  patch: AutomationSubjectState,
) {
  await db
    .update(sessions)
    .set({
      // Merged with `||` rather than jsonb_set, which cannot create the intermediate key on a
      // session whose metadata has no `automation_subject` yet.
      session_metadata: sql`${sessions.session_metadata} || jsonb_build_object(
        'automation_subject',
        COALESCE(${sessions.session_metadata} -> 'automation_subject', '{}'::jsonb)
          || ${JSON.stringify(patch)}::jsonb
      )`,
      ...unchanged_lifecycle_columns(sessions),
    })
    .where(
      and(eq(sessions.workspace_id, input.workspace_id), eq(sessions.session_id, input.session_id)),
    );
}

export function find_automation_subject_session(
  db: Database,
  input: { workspace_id: string; agent_id: string; session_key: string },
) {
  return db.query.sessions.findFirst({
    where: and(
      eq(sessions.workspace_id, input.workspace_id),
      eq(sessions.agent_id, input.agent_id),
      eq(sessions.session_source, automation_session_source),
      eq(sessions.external_thread_key, input.session_key),
      ne(sessions.session_status, 'deleted'),
    ),
  });
}
