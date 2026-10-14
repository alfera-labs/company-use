import { built_in_scope_kinds } from '@coworker/memory/contracts/scope_kinds';
import type { ScopeKindRecord, ScopeKindRegistry } from '@coworker/memory/contracts/scopes';

export type ScopeKindRegistryBuildResult =
  | { outcome: 'ok'; registry: ScopeKindRegistry }
  | { outcome: 'invalid_scope_kind_registry'; problem: string; scope_kind: string };

export function build_scope_kind_registry(
  extra_scope_kinds: readonly ScopeKindRecord[],
): ScopeKindRegistryBuildResult {
  const records = [...built_in_scope_kinds, ...extra_scope_kinds];
  return { outcome: 'ok', registry: new Map(records.map((record) => [record.scope_kind, record])) };
}
