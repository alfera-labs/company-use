import { scope_kind_name_schema } from '@coworker/memory/contracts/keys';
import type { ScopeKindRecord } from '@coworker/memory/contracts/scopes';

export const built_in_scope_kinds: readonly ScopeKindRecord[] = [
  { scope_kind: scope_kind_name_schema.parse('workspace') },
  { scope_kind: scope_kind_name_schema.parse('person') },
  { scope_kind: scope_kind_name_schema.parse('project') },
  { scope_kind: scope_kind_name_schema.parse('group') },
];
