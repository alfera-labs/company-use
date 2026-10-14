import {
  type ScopeKey,
  type ScopeKindName,
  scope_key_schema,
  scope_kind_name_schema,
} from '@coworker/memory/contracts/keys';

export const workspace_scope_key: ScopeKey = scope_key_schema.parse('workspace');

export function scope_kind_of(scope_key: ScopeKey): ScopeKindName {
  return scope_kind_name_schema.parse(scope_key.split(':')[0]);
}
