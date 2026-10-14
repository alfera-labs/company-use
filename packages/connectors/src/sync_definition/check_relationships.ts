import {
  list_unregistered_relations,
  relationship_key_pattern,
} from '@connectors/sync_definition/relationship_schema';
import { is_scope_day_of } from '@connectors/sync_definition/sync_object_schema';
import type { ConnectorSyncObject } from '@connectors/sync_types';
import type { ConnectorApp } from '@connectors/types';

export function check_relationships(
  app: ConnectorApp,
  object: ConnectorSyncObject,
  where: string,
): readonly string[] {
  const kinds = Object.entries(object.relationships ?? {});
  for (const [kind, value] of kinds) {
    if (!relationship_key_pattern.test(kind)) {
      throw new Error(`${where} relationship key '${kind}' must match ^[a-z][a-z0-9_]{1,40}$`);
    }
    if (!is_scope_day_of(value)) continue;
    const keys = Object.keys(value);
    if (keys.length !== 1) {
      throw new Error(
        `${where} relationship ${kind} mixes scope_day_of with other keys: ${keys.join(', ')}`,
      );
    }
  }
  const unregistered = list_unregistered_relations(
    app,
    kinds.map(([kind]) => kind),
  );
  return unregistered.map(
    (relation) => `${where} relationship '${relation}' is unregistered_relation`,
  );
}
