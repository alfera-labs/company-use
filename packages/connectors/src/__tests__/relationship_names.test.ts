import { check_sync_extensions } from '@connectors/sync_definition/check_sync_extensions';
import { resolve_app_relation } from '@connectors/sync_definition/relationship_schema';
import type { ConnectorApp } from '@connectors/types';
import { describe, expect, it } from 'vitest';

const list_records_node = {
  node_key: 'demo-list_records-1',
  description: 'List demo records.',
  implementation: 'execute',
  input_schema: { type: 'object', properties: {} },
  output_schema: { type: 'object', properties: { records: { type: 'array' } } },
};

function build_app(
  relationships: Record<string, unknown>,
  relation_records: ConnectorApp['relation_records'] = undefined,
): ConnectorApp {
  return {
    app_key: 'demo',
    display_name: 'Demo',
    base_url: 'https://demo.invalid',
    rate_limits: { rpm: 60, concurrency: 1, burst: 1 },
    auth: { kind: 'none' },
    relation_records,
    sync: {
      dimensions: [
        {
          key: 'objects',
          label: 'Objects',
          shape: 'flat',
          browse_node: list_records_node.node_key,
        },
      ],
      objects: {
        record: {
          list_node: list_records_node.node_key,
          scoped_by: { objects: 'object_type' },
          page: { cursor_param: 'cursor', items: { $: 'response.records' } },
          strategy: 'relist_diff',
          identity: { $: 'item.id' },
          title: { $: 'item.name' },
          content: { $: 'item.body' },
          item_kind: 'record',
          relationships,
        },
      },
    },
  } as ConnectorApp;
}

describe('resolve_app_relation', () => {
  it('finds a built-in relation and names its family', () => {
    const app = build_app({});
    expect(resolve_app_relation(app, 'assignee')).toMatchObject({
      link_family: 'mentions',
      registered: true,
    });
  });

  it('lets an app declare a relation record that is not built in', () => {
    const app = build_app({}, [
      {
        relation: 'owns_deal',
        link_family: 'mentions',
        inverse_relation: null,
        allowed_link_methods: [],
      },
    ]);
    expect(resolve_app_relation(app, 'owns_deal')).toMatchObject({
      link_family: 'mentions',
      registered: true,
    });
  });

  it('falls back unregistered for a relation with no built-in and no declared record', () => {
    expect(resolve_app_relation(build_app({}), 'owns_deal').registered).toBe(false);
  });
});

describe('check_sync_extensions relationship warnings', () => {
  it('warns unregistered_relation for an unknown relation key', () => {
    const app = build_app({ owns_deal: { $: 'item.owner_id' } });
    const warnings = check_sync_extensions(app, 'apps/demo/app.json');
    expect(warnings).toEqual([
      "apps/demo/app.json: sync object record relationship 'owns_deal' is unregistered_relation",
    ]);
  });

  it('emits no warning for a built-in relation key', () => {
    const app = build_app({ assignee: { $: 'item.assignee_id' } });
    expect(check_sync_extensions(app, 'apps/demo/app.json')).toEqual([]);
  });

  it('emits no warning when the app declares a matching relation record', () => {
    const app = build_app({ owns_deal: { $: 'item.owner_id' } }, [
      {
        relation: 'owns_deal',
        link_family: 'mentions',
        inverse_relation: null,
        allowed_link_methods: [],
      },
    ]);
    expect(check_sync_extensions(app, 'apps/demo/app.json')).toEqual([]);
  });
});
