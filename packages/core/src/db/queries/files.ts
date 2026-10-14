import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { files } from '@coworker/core/db/schema';
import type { FileMetadataData } from '@coworker/core/db/schema/json_column_types';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

export type CreateFileInput = {
  file_id?: string;
  workspace_id: string;
  project_id?: string | null;
  session_id?: string | null;
  run_id?: string | null;
  runtime_environment_id?: string | null;
  source_tool_call_id?: string | null;
  file_purpose: string;
  file_status?: string;
  file_direction?: 'inbound' | 'outbound';
  storage_provider: string;
  storage_key: string;
  workspace_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  checksum_sha256?: string | null;
  content_preview?: string | null;
  is_visible?: boolean;
  file_metadata?: FileMetadataData;
  actor_id: string;
};

export async function create_file(db: Database, input: CreateFileInput) {
  const [file] = await db
    .insert(files)
    .values({
      file_id: input.file_id ?? create_id(id_prefixes.artifact),
      workspace_id: input.workspace_id,
      project_id: input.project_id ?? null,
      session_id: input.session_id ?? null,
      run_id: input.run_id ?? null,
      runtime_environment_id: input.runtime_environment_id ?? null,
      source_tool_call_id: input.source_tool_call_id ?? null,
      file_purpose: input.file_purpose,
      file_status: input.file_status ?? 'ready',
      file_direction: input.file_direction ?? 'outbound',
      storage_provider: input.storage_provider,
      storage_key: input.storage_key,
      workspace_path: input.workspace_path ?? null,
      file_name: input.file_name ?? null,
      mime_type: input.mime_type ?? null,
      byte_size: input.byte_size ?? null,
      checksum_sha256: input.checksum_sha256 ?? null,
      content_preview: input.content_preview ?? null,
      is_visible: input.is_visible ?? true,
      file_metadata: input.file_metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(file, 'File');
}

export function create_pending_upload_file(
  db: Database,
  input: Omit<CreateFileInput, 'file_status' | 'file_direction'> & {
    file_id: string;
  },
) {
  const { file_id, ...rest } = input;
  return db
    .insert(files)
    .values({
      file_id,
      workspace_id: rest.workspace_id,
      project_id: rest.project_id ?? null,
      session_id: rest.session_id ?? null,
      run_id: rest.run_id ?? null,
      runtime_environment_id: null,
      source_tool_call_id: null,
      file_purpose: rest.file_purpose,
      file_status: 'pending',
      file_direction: 'inbound',
      storage_provider: rest.storage_provider,
      storage_key: rest.storage_key,
      workspace_path: null,
      file_name: rest.file_name ?? null,
      mime_type: rest.mime_type ?? null,
      byte_size: rest.byte_size ?? null,
      checksum_sha256: null,
      content_preview: null,
      is_visible: rest.is_visible ?? true,
      file_metadata: rest.file_metadata ?? {},
      created_by: rest.actor_id,
      last_updated_by: rest.actor_id,
    })
    .returning()
    .then((rows) => require_inserted_row(rows[0], 'File'));
}

export async function find_ingested_file(
  db: Database,
  input: {
    workspace_id: string;
    app_key: string;
    external_file_id: string;
    checksum_sha256: string;
  },
) {
  return db.query.files.findFirst({
    where: and(
      eq(files.workspace_id, input.workspace_id),
      eq(files.checksum_sha256, input.checksum_sha256),
      sql`${files.file_metadata}->>'app_key' = ${input.app_key}`,
      sql`${files.file_metadata}->>'external_file_id' = ${input.external_file_id}`,
    ),
  });
}

export const stored_tool_result_file_purpose = 'stored_tool_result';
export const stored_context_snapshot_file_purpose = 'stored_context_snapshot';
export const stored_run_event_file_purpose = 'stored_run_event';

export async function list_run_files(db: Database, workspace_id: string, run_id: string) {
  return db.query.files.findMany({
    where: and(
      eq(files.workspace_id, workspace_id),
      eq(files.run_id, run_id),
      notInArray(files.file_purpose, [
        stored_tool_result_file_purpose,
        stored_context_snapshot_file_purpose,
        stored_run_event_file_purpose,
      ]),
    ),
    orderBy: (table, { asc }) => [asc(table.created_time)],
  });
}

export async function get_file(db: Database, workspace_id: string, file_id: string) {
  return db.query.files.findFirst({
    where: and(eq(files.workspace_id, workspace_id), eq(files.file_id, file_id)),
  });
}

export async function list_files_by_ids(
  db: Database,
  workspace_id: string,
  file_ids: readonly string[],
) {
  if (file_ids.length === 0) return [];
  return db.query.files.findMany({
    where: and(eq(files.workspace_id, workspace_id), inArray(files.file_id, [...file_ids])),
  });
}

export async function mark_file_stored(
  db: Database,
  input: {
    workspace_id: string;
    file_id: string;
    byte_size: number;
    checksum_sha256?: string | null;
    actor_id: string;
  },
) {
  const [file] = await db
    .update(files)
    .set({
      file_status: 'ready',
      byte_size: input.byte_size,
      ...(input.checksum_sha256 === undefined ? {} : { checksum_sha256: input.checksum_sha256 }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(files.workspace_id, input.workspace_id), eq(files.file_id, input.file_id)))
    .returning();

  return require_inserted_row(file, 'File');
}

export async function mark_file_missing(
  db: Database,
  input: { workspace_id: string; file_id: string; actor_id: string },
) {
  const [file] = await db
    .update(files)
    .set({
      file_status: 'missing',
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(files.workspace_id, input.workspace_id), eq(files.file_id, input.file_id)))
    .returning();

  return require_inserted_row(file, 'File');
}
