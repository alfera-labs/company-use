import type { ConnectorRelationRecord, RelationFamilyLookup } from '@connectors/relation_families';
import { read_relation_family } from '@connectors/relation_families';
import type { ConnectorApp } from '@connectors/types';

export const relationship_key_pattern = /^[a-z][a-z0-9_]{1,40}$/;

export function resolve_app_relation(app: ConnectorApp, relation: string): RelationFamilyLookup {
  return read_relation_family(app.relation_records ?? [], relation);
}

export function list_unregistered_relations(
  app: ConnectorApp,
  relations: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const unregistered: string[] = [];
  for (const relation of relations) {
    if (seen.has(relation)) continue;
    seen.add(relation);
    if (!resolve_app_relation(app, relation).registered) unregistered.push(relation);
  }
  return unregistered;
}

export type { ConnectorRelationRecord, RelationFamilyLookup };
