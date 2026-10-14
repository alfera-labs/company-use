import type { ScopeKindName } from '@coworker/memory/contracts/keys';

export type ScopeKindRecord = { scope_kind: ScopeKindName };

export type ScopeKindRegistry = ReadonlyMap<ScopeKindName, ScopeKindRecord>;
