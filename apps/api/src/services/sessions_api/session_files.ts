import { require_owned_api_session } from '@api/services/sessions_api/session_reads';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { get_file, list_run_files } from '@coworker/core/db/queries/files';
import { get_run, list_session_runs } from '@coworker/core/db/queries/sessions';
import { open_runtime_file } from '@coworker/runtime-platform';
import { NotFoundError } from '@coworker/shared';

export type PublicSessionFile = {
  file_id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_time: Date;
};

export async function list_api_session_files(
  db: Database,
  api_key: ApiKey,
  session_id: string,
): Promise<PublicSessionFile[]> {
  await require_owned_api_session(db, api_key, session_id);
  const session_runs = await list_session_runs(db, api_key.workspace_id, session_id);
  // One list per run. A session has a handful of runs, and this is the same read the
  // dashboard's run-files route makes; join them in one query if a session ever holds hundreds.
  const per_run = await Promise.all(
    session_runs.map((run) => list_run_files(db, api_key.workspace_id, run.run_id)),
  );
  return newest_record_of_each_path(per_run.flat()).map(public_session_file);
}

type SessionFileRecord = Awaited<ReturnType<typeof list_run_files>>[number];

function newest_record_of_each_path(records: SessionFileRecord[]) {
  const oldest_first = (left: SessionFileRecord, right: SessionFileRecord) =>
    left.created_time.getTime() - right.created_time.getTime();
  const newest_by_path = new Map(
    records.sort(oldest_first).map((record) => [record.workspace_path ?? record.file_id, record]),
  );
  return [...newest_by_path.values()].sort(oldest_first);
}

export type OpenedSessionFile = {
  file: PublicSessionFile;
  content_bytes: Uint8Array;
  mime_type: string;
};

export async function open_api_session_file(
  db: Database,
  api_key: ApiKey,
  file_id: string,
): Promise<OpenedSessionFile> {
  const file = await get_file(db, api_key.workspace_id, file_id);
  if (!file?.run_id) throw new NotFoundError('File');
  const run = await get_run(db, api_key.workspace_id, file.run_id);
  if (!run?.session_id) throw new NotFoundError('File');
  await require_owned_api_session(db, api_key, run.session_id);

  const opened = await open_runtime_file(db, {
    workspace_id: api_key.workspace_id,
    file_id,
    actor_id: api_key.api_key_id,
  });
  if (opened.missing) throw new NotFoundError('File bytes');
  return {
    file: public_session_file(file),
    content_bytes: opened.content_bytes,
    mime_type: opened.mime_type,
  };
}

function public_session_file(file: {
  file_id: string;
  file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  created_time: Date;
}): PublicSessionFile {
  return {
    file_id: file.file_id,
    filename: file.file_name,
    mime_type: file.mime_type,
    size_bytes: file.byte_size,
    created_time: file.created_time,
  };
}
