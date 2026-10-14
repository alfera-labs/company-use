import { no_store_request, read_api_data, run_by_id_client } from '@/lib/api/client';

export type RunFileRecord = { workspace_path: string | null; created_time: string };

/** The files one run wrote, oldest first, each with its path in the workspace when it has one. */
export async function list_run_files(run_id: string): Promise<RunFileRecord[]> {
  return read_api_data<RunFileRecord[]>(
    await run_by_id_client.files.$get({ param: { run_id } }, no_store_request),
    { method: 'GET', path: `/v1/runs/${run_id}/files` },
  );
}
