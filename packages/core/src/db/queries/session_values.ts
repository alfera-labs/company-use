import type { Database } from '@coworker/core/db/connection';
import { read_execute_rows } from '@coworker/core/db/queries/read_execute_rows';
import type { CreateSessionInput } from '@coworker/core/db/queries/sessions';
import { read_table_row_from_json } from '@coworker/core/db/queries/table_row_from_json';
import { sessions } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { sql } from 'drizzle-orm';

const placeholder_title = { title_generation: { source: 'placeholder' } } as const;

export function build_session_values(input: CreateSessionInput) {
  return {
    session_id: create_id(id_prefixes.session),
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    project_id: input.project_id ?? null,
    session_title: input.session_title ?? 'Untitled session',
    session_status: 'active',
    source_type: input.source_type ?? 'dashboard',
    session_source: input.session_source ?? input.source_type ?? 'dashboard',
    external_thread_key: input.external_thread_key ?? null,
    source_metadata: input.source_metadata ?? {},
    session_metadata: {
      ...(input.session_title ? {} : placeholder_title),
      ...input.session_metadata,
    },
    created_by: input.actor_id,
    last_updated_by: input.actor_id,
  } satisfies typeof sessions.$inferInsert;
}

export async function create_session_in_personal_project(
  db: Database,
  input: Omit<CreateSessionInput, 'project_id'> & { user_id: string },
) {
  const values = build_session_values(input);
  const result = await db.execute(sql`
    INSERT INTO sessions (session_id, workspace_id, agent_id, project_id, session_title,
      session_status, source_type, session_source, external_thread_key, source_metadata,
      session_metadata, created_by, last_updated_by)
    SELECT ${values.session_id}, ${values.workspace_id}, ${values.agent_id}, project_id,
      ${values.session_title}, ${values.session_status}, ${values.source_type},
      ${values.session_source}, ${values.external_thread_key},
      ${JSON.stringify(values.source_metadata)}::jsonb,
      ${JSON.stringify(values.session_metadata)}::jsonb, ${values.created_by},
      ${values.last_updated_by}
    FROM projects
    WHERE workspace_id = ${input.workspace_id} AND personal_for_user_id = ${input.user_id}
    LIMIT 1
    RETURNING to_jsonb(sessions.*) AS session_row
  `);
  const [row] = read_execute_rows<{ session_row: Record<string, unknown> }>(result);
  return row ? read_table_row_from_json(sessions, row.session_row) : null;
}
