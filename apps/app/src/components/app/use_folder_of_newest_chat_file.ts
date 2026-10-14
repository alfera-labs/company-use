// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.
import { useEffect, useState } from 'react';
import { list_session_runs } from '@/lib/api';
import { list_run_files, type RunFileRecord } from '@/lib/api/run_files';

const runs_looked_at = 5;
const longest_wait_ms = 1500;

/** The folder of the file written last, or null when no record has a place in the workspace. */
export function folder_of_newest_file(records: readonly RunFileRecord[]): string | null {
  const newest = records
    .filter((record) => record.workspace_path)
    .sort((left, right) => right.created_time.localeCompare(left.created_time))[0];
  const file_path = newest?.workspace_path;
  if (!file_path) return null;
  return file_path.slice(0, Math.max(file_path.lastIndexOf('/'), 0));
}

async function find_folder_of_newest_chat_file(session_id: string) {
  const newest_runs = (await list_session_runs(session_id)).slice(0, runs_looked_at);
  const records = await Promise.all(newest_runs.map((run) => list_run_files(run.run_id)));
  return folder_of_newest_file(records.flat());
}

/**
 * Where the Files panel of a chat opens: the folder of the file the chat wrote last, so that
 * file is on screen and not two folders down. It is undefined while the panel is closed and
 * while the answer is on its way (the panel draws no folder yet, so no folder is shown and
 * then swapped), and null when the chat wrote no file or the answer did not come in time.
 */
export function use_folder_of_newest_chat_file(session_id: string | undefined, is_open: boolean) {
  const [folder, set_folder] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    set_folder(undefined);
    if (!is_open) return;
    let is_wanted = true;
    const too_late = new Promise<null>((resolve) => setTimeout(resolve, longest_wait_ms, null));
    const found = session_id ? find_folder_of_newest_chat_file(session_id) : null;
    void Promise.race([found, too_late])
      .catch((error: unknown) => {
        console.warn('The Files panel opens at the top: the newest file was not found.', error);
        return null;
      })
      .then((answer) => is_wanted && set_folder(answer));
    return () => {
      is_wanted = false;
    };
  }, [session_id, is_open]);
  return folder;
}
