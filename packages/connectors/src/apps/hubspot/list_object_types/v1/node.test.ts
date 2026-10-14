import {
  build_hubspot_context,
  check_output_against_schema,
  load_hubspot_node,
  stub_hubspot_fetch,
} from '@connectors/apps/hubspot/__tests__/hubspot_test_support';
import app_definition from '@connectors/apps/hubspot/app.json' with { type: 'json' };
import * as execute_module from '@connectors/apps/hubspot/list_object_types/v1/execute';
import { execute } from '@connectors/apps/hubspot/list_object_types/v1/execute';
import fixtures from '@connectors/apps/hubspot/list_object_types/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/hubspot/list_object_types/v1/node.json' with {
  type: 'json',
};
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const node = load_hubspot_node('list_object_types', definition, execute_module);

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot-list_object_types-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    expect(node.node_key).toBe('hubspot-list_object_types-1');
    expect(node.implementation).toBe('execute');
    expect(node.execute).toBe(execute);
    expect(node.required_scopes).toEqual(['crm.schemas.custom.read']);
    expect(definition.endpoints[0]?.path).toBe('/crm/v3/schemas');
    expect(app_definition.auth.authorization_params.optional_scope).toBe('crm.schemas.custom.read');
  });

  it('declares the four standard object types as data, not as a call', () => {
    expect(definition.standard_object_types.map((standard) => standard.id)).toEqual([
      'contacts',
      'companies',
      'deals',
      'tickets',
    ]);
  });

  it('takes the browse input and answers with the scope-option shape', () => {
    expect(Object.keys(definition.input_schema.properties)).toEqual([
      'parent_id',
      'query',
      'cursor',
      'limit',
    ]);
    expect(definition.output_schema.required).toEqual(['options', 'next_cursor']);
  });

  it('is the browse node the app sync declaration points at', () => {
    expect(app_definition.sync.dimensions[0]).toMatchObject({
      key: 'objects',
      shape: 'flat',
      browse_node: 'hubspot-list_object_types-1',
    });
  });
});

describe('hubspot-list_object_types-1 execute', () => {
  it('offers the standard types and the portal custom objects as one list', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.custom_schemas }));

    const output = await execute({}, build_hubspot_context());

    expect(calls).toEqual([
      {
        method: 'GET',
        url: 'https://api.hubapi.com/crm/v3/schemas',
        path: '/crm/v3/schemas',
        body: undefined,
      },
    ]);
    expect(output).toEqual({
      options: [
        { id: 'contacts', label: 'Contacts', kind: 'object', selectable: true },
        { id: 'companies', label: 'Companies', kind: 'object', selectable: true },
        { id: 'deals', label: 'Deals', kind: 'object', selectable: true },
        { id: 'tickets', label: 'Tickets', kind: 'object', selectable: true },
        {
          id: '2-3399991',
          label: 'Roast batches',
          sublabel: 'roast_batches',
          kind: 'custom_object',
          selectable: true,
        },
        {
          id: 'unlabelled_object',
          label: 'unlabelled_object',
          sublabel: 'unlabelled_object',
          kind: 'custom_object',
          selectable: true,
        },
      ],
      next_cursor: null,
    });
    check_output_against_schema(output, node.output_schema);
  });

  it('leaves an archived custom object out of the picker', async () => {
    stub_hubspot_fetch(() => ({ body: fixtures.custom_schemas }));

    const output = await execute({}, build_hubspot_context());

    expect(output.options.map((option) => option.id)).not.toContain('2-3400012');
  });

  it('keeps the types whose label or name contains the query', async () => {
    stub_hubspot_fetch(() => ({ body: fixtures.custom_schemas }));

    const output = await execute({ query: 'roast' }, build_hubspot_context());

    expect(output.options.map((option) => option.id)).toEqual(['2-3399991']);
  });

  it('still offers the standard types in a portal with no custom objects', async () => {
    stub_hubspot_fetch(() => ({ body: fixtures.custom_schemas_empty }));

    const output = await execute({}, build_hubspot_context());

    expect(output.options).toHaveLength(4);
    expect(output.next_cursor).toBeNull();
  });

  it('turns a missing scope into a typed error, not a retry storm', async () => {
    const calls = stub_hubspot_fetch(() => ({
      status: 403,
      body: fixtures.custom_schemas_forbidden,
    }));

    await expect(execute({}, build_hubspot_context())).rejects.toMatchObject({
      retryable: false,
      status: 403,
    });
    expect(calls).toHaveLength(1);
  });
});
