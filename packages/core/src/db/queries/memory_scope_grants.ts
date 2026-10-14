import { memory_scope_resource_type } from '@coworker/core/access/resource_types';
import type { Database } from '@coworker/core/db/connection';
import { list_grants_for_resource } from '@coworker/core/db/queries/resource_grants';
import {
  type ReplaceMemoryScopeMembersForSweepInput,
  replace_memory_scope_members_for_sweep,
} from '@coworker/core/db/queries/resource_grants_memory_scope_sweep';

export type { MemoryScopeMember } from '@coworker/core/db/queries/resource_grants_memory_scope_sweep';

export type ReplaceMemoryScopeGrantsInput = ReplaceMemoryScopeMembersForSweepInput;

export type MemoryScopeGrantsSweepResult =
  | { outcome: 'swept'; added: string[]; removed: string[] }
  | { outcome: 'superseded_by_newer_sweep'; newest_swept_time: string }
  | { outcome: 'scope_item_not_found' };

export async function replace_memory_scope_grants(
  db: Database,
  input: ReplaceMemoryScopeGrantsInput,
): Promise<MemoryScopeGrantsSweepResult> {
  const grantee_ids_before = await list_memory_scope_grantee_ids(db, input);
  const sweep_result = await replace_memory_scope_members_for_sweep(db, input);
  if (sweep_result.outcome !== 'swept') return sweep_result;

  const grantee_ids_after = await list_memory_scope_grantee_ids(db, input);
  return {
    outcome: 'swept',
    added: grantee_ids_only_in(grantee_ids_after, grantee_ids_before),
    removed: grantee_ids_only_in(grantee_ids_before, grantee_ids_after),
  };
}

type ScopeRef = { workspace_id: string; scope_key: string };

async function list_memory_scope_grantee_ids(db: Database, input: ScopeRef): Promise<string[]> {
  const rows = await list_grants_for_resource(db, {
    workspace_id: input.workspace_id,
    resource_type: memory_scope_resource_type,
    resource_id: input.scope_key,
  });
  return rows.map((row) => row.grantee_id);
}

function grantee_ids_only_in(left: readonly string[], right: readonly string[]): string[] {
  const right_set = new Set(right);
  return left.filter((grantee_id) => !right_set.has(grantee_id));
}
