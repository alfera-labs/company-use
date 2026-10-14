import { type apps, type Database, nodes } from '@coworker/core';
import { get_composio_app_by_toolkit } from '@coworker/core/db/queries/catalog';
import { create_id, id_prefixes } from '@coworker/shared';
import { sql } from 'drizzle-orm';

const actor_id = 'system:attio_trigger_catalog';

const attio_app_name = 'attio';
const attio_trigger_handler_prefix = 'attio.trigger.';

const attio_object_input_schema = {
  type: 'object' as const,
  properties: {
    object: {
      type: 'string' as const,
      title: 'Object',
      description: 'Only this object — people, companies, deals. Leave empty for every object.',
    },
  },
};

type AttioTriggerSeed = {
  node_name: string;
  node_key: string;
  node_display_name: string;
  event_type: string;
  description: string;
  data_fields: string[];
  subject_field: string;
};

const record_data_fields = ['record_id', 'object_id', 'event_type', 'actor_type', 'actor_id'];

const attio_trigger_seeds: AttioTriggerSeed[] = [
  {
    node_name: 'record_created',
    node_key: 'attio-record_created-1',
    node_display_name: 'A record is created in Attio',
    event_type: 'record.created',
    description:
      'Every record added to your Attio workspace. Narrow it to one object — people, companies, deals — or leave it empty for all of them.',
    data_fields: record_data_fields,
    subject_field: 'record_id',
  },
  {
    node_name: 'record_updated',
    node_key: 'attio-record_updated-1',
    node_display_name: 'A record is updated in Attio',
    event_type: 'record.updated',
    description:
      'Every change to a record in your Attio workspace. Narrow it to one object — people, companies, deals — or leave it empty for all of them.',
    data_fields: record_data_fields,
    subject_field: 'record_id',
  },
  {
    node_name: 'note_created',
    node_key: 'attio-note_created-1',
    node_display_name: 'A note is added in Attio',
    event_type: 'note.created',
    description:
      'Every note written on a record in your Attio workspace. Narrow it to one object — people, companies, deals — or leave it empty for all of them.',
    data_fields: [...record_data_fields, 'note_id', 'parent_object', 'parent_record_id'],
    subject_field: 'parent_record_id',
  },
];

export async function seed_attio_trigger_catalog(db: Database) {
  const app = await get_composio_app_by_toolkit(db, { toolkit_slug: attio_app_name });
  if (!app) return;
  for (const seed of attio_trigger_seeds) {
    await upsert_attio_trigger_node(db, app, seed);
  }
}

function attio_trigger_node_values(app: typeof apps.$inferSelect, seed: AttioTriggerSeed) {
  return {
    app_id: app.app_id,
    app_key: app.app_key,
    catalog_scope: 'global',
    node_key: seed.node_key,
    node_version: 1,
    node_name: seed.node_name,
    node_display_name: seed.node_display_name,
    node_kind: 'trigger',
    input_schema: attio_object_input_schema,
    runtime_handler: `${attio_trigger_handler_prefix}${seed.event_type}`,
    node_runtime: 'connected_app',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'native',
    provider_config_key: `native:${attio_app_name}`,
    provider_config_version: 1,
    connection_profile_key: `native:${attio_app_name}:default`,
    connection_profile_version: 1,
    node_config: {
      sourced_from: {
        provider: 'native',
        provider_app_id: `native:${attio_app_name}`,
        provider_component_id: seed.event_type,
        provider_component_version: '1',
      },
      subject_field: seed.subject_field,
      wire: { provisioned_by: 'attio' as const, trigger_slug: seed.event_type },
    },
    metadata: {
      source: 'attio_trigger_catalog',
      node_key: seed.node_key,
      description: seed.description,
      app_name: app.app_name,
      required_connection: true,
      data_fields: seed.data_fields,
    },
  };
}

async function upsert_attio_trigger_node(
  db: Database,
  app: typeof apps.$inferSelect,
  seed: AttioTriggerSeed,
) {
  const values = attio_trigger_node_values(app, seed);
  const [node] = await db
    .insert(nodes)
    .values({
      node_id: create_id(id_prefixes.node),
      ...values,
      created_by: actor_id,
      last_updated_by: actor_id,
    })
    .onConflictDoUpdate({
      target: nodes.node_key,
      targetWhere: sql`${nodes.catalog_scope} = 'global' AND ${nodes.workspace_id} IS NULL`,
      set: { ...values, last_updated_time: new Date(), last_updated_by: actor_id },
    })
    .returning({ node_id: nodes.node_id });
  if (!node) throw new Error(`Attio trigger node seed failed: ${seed.node_key}`);
}
