import app_definition from '@connectors/apps/salesforce/app.json' with { type: 'json' };
import * as execute_module from '@connectors/apps/salesforce/list_object_types/v1/execute';
import { list_salesforce_object_types } from '@connectors/apps/salesforce/list_object_types/v1/execute';
import fixtures from '@connectors/apps/salesforce/list_object_types/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/salesforce/list_object_types/v1/node.json' with {
  type: 'json',
};
import {
  build_connection_without_instance_url,
  build_salesforce_test_context,
  salesforce_test_instance_url,
} from '@connectors/apps/salesforce/salesforce_test_context';
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_node } from '@connectors/load_definition';
import type { JsonSchema } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

const node = load_connector_node(
  'apps/salesforce/list_object_types/v1/node.json',
  definition,
  execute_module,
);

describe('salesforce-list_object_types-1 node.json', () => {
  it('loads through the framework loader and is keyed by its own path', () => {
    expect(node.node_key).toBe('salesforce-list_object_types-1');
    expect(node.implementation).toBe('execute');
    expect(node.required_scopes).toEqual(['api']);
    expect(definition.requests.describe_global.path).toBe('/services/data/v61.0/sobjects');
  });

  it('takes the browse input and answers with the scope-option shape', () => {
    expect(Object.keys(definition.input_schema.properties)).toEqual([
      'parent_id',
      'query',
      'cursor',
      'limit',
    ]);
    expect(definition.output_schema.required).toEqual(['options', 'next_cursor']);
    expect(Object.keys(definition.output_schema.properties.options.items.properties)).toEqual([
      'id',
      'label',
      'sublabel',
      'preview',
      'kind',
      'has_children',
      'selectable',
    ]);
  });

  it('is the browse node the app sync declaration points at', () => {
    expect(app_definition.sync.dimensions[0]).toMatchObject({
      key: 'objects',
      shape: 'flat',
      browse_node: 'salesforce-list_object_types-1',
    });
  });
});

describe('salesforce-list_object_types-1 execute', () => {
  it('describes the connection org and offers only the objects a person would sync', async () => {
    const { context, requests } = build_salesforce_test_context(() => fixtures.describe_global);

    const output = await list_salesforce_object_types({}, context);

    expect(requests).toEqual([
      {
        base_url: salesforce_test_instance_url,
        method: 'GET',
        path: '/services/data/v61.0/sobjects',
        query: undefined,
        body: undefined,
      },
    ]);
    expect(output).toEqual({
      options: [
        { id: 'Account', label: 'Account', kind: 'object', selectable: true },
        { id: 'Opportunity', label: 'Opportunity', kind: 'object', selectable: true },
        {
          id: 'Roast_Batch__c',
          label: 'Roast Batch',
          sublabel: 'Roast_Batch__c',
          kind: 'custom_object',
          selectable: true,
        },
      ],
      next_cursor: null,
    });
    expect(
      find_json_schema_violation(definition.output_schema as JsonSchema, output, 'output'),
    ).toBeNull();
  });

  it('drops the share, history, feed, change-event, unqueryable and retired objects', async () => {
    const { context } = build_salesforce_test_context(() => fixtures.describe_global);

    const output = await list_salesforce_object_types({}, context);

    expect(output.options.map((option) => option.id)).not.toContain('AccountShare');
    expect(output.options.map((option) => option.id)).not.toContain('AccountHistory');
    expect(output.options.map((option) => option.id)).not.toContain('AccountFeed');
    expect(output.options.map((option) => option.id)).not.toContain('AccountChangeEvent');
    expect(output.options.map((option) => option.id)).not.toContain('AcceptedEventRelation');
    expect(output.options.map((option) => option.id)).not.toContain('OldRetiredThing');
  });

  it('keeps the objects whose label or API name contains the query', async () => {
    const { context } = build_salesforce_test_context(() => fixtures.describe_global);

    const output = await list_salesforce_object_types({ query: 'roast' }, context);

    expect(output.options.map((option) => option.id)).toEqual(['Roast_Batch__c']);
  });

  it('refuses a connection the OAuth exchange never stored instance_url on', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.describe_global,
      build_connection_without_instance_url(),
    );

    await expect(list_salesforce_object_types({}, context)).rejects.toThrow(/instance_url/u);
    expect(requests).toHaveLength(0);
  });
});
