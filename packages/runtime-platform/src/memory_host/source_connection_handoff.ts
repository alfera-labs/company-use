import type { Database } from '@coworker/core';

export async function hand_waiting_sources_to_connection(
  _db: Database,
  _input: { workspace_id: string; connection_id: string; actor_id: string },
): Promise<{ moved_source_ids: string[] }> {
  return { moved_source_ids: [] };
}
