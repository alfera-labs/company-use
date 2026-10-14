import { read_api_data, session_by_id_client } from '@/lib/api/client';
import type { Session } from '@/lib/api/types';

export async function rename_chat(session_id: string, session_title: string): Promise<Session> {
  return read_api_data<Session>(
    await session_by_id_client.$patch({ param: { session_id }, json: { session_title } }),
    { method: 'PATCH', path: `/v1/sessions/${session_id}` },
  );
}

export type MovedChat = Session & { connections_lost: string[] };

/** `shares_it` is the person's yes to a move that lets other people read the chat. */
export async function move_chat_to_project(
  session_id: string,
  project_id: string | null,
  shares_it = false,
): Promise<MovedChat> {
  const json = shares_it ? { project_id, share_with_its_readers: true as const } : { project_id };
  return read_api_data<MovedChat>(
    await session_by_id_client.$patch({ param: { session_id }, json }),
    { method: 'PATCH', path: `/v1/sessions/${session_id}` },
  );
}
