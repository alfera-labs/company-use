import type { Database } from '@coworker/core/db/connection';

type NameOf = (grantee_type: string, grantee_id: string) => string;
type MemoryScopeReader = {
  grantee_type: 'user' | 'api_key';
  grantee_id: string;
  name: string;
  reader_origin: 'member_sync' | 'admin' | 'project_membership';
};
export type MemoryScopeRow = {
  scope_key: string;
  scope_kind: 'project' | 'group';
  display_name: string;
  readers: MemoryScopeReader[];
};

export function read_memory_scope_name_lookup(_members: unknown, _api_keys: unknown): NameOf {
  return (_grantee_type, grantee_id) => grantee_id;
}

export async function read_memory_scope_rows(
  _db: Database,
  _workspace_id: string,
  _input: unknown,
): Promise<MemoryScopeRow[]> {
  return [];
}
