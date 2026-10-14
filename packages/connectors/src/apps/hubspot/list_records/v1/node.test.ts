import {
  build_hubspot_context,
  check_node_definition,
  check_output_against_schema,
  load_hubspot_node,
  type NodeQuirks,
  stub_hubspot_fetch,
} from '@connectors/apps/hubspot/__tests__/hubspot_test_support';
import type {
  ListRecordsInput,
  ListRecordsOutput,
} from '@connectors/apps/hubspot/list_records/v1/execute';
import * as execute_module from '@connectors/apps/hubspot/list_records/v1/execute';
import fixtures from '@connectors/apps/hubspot/list_records/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/hubspot/list_records/v1/node.json' with { type: 'json' };
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const node = load_hubspot_node('list_records', definition, execute_module);
const extras = node as unknown as NodeQuirks;

function run(input: ListRecordsInput) {
  return execute_module.execute(input, build_hubspot_context()) as Promise<ListRecordsOutput>;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot-list_records-1 node.json', () => {
  it('declares both endpoints and when each one runs', () => {
    check_node_definition(node, 'hubspot-list_records-1');
    expect(node.implementation).toBe('execute');
    expect(extras.endpoints).toEqual([
      {
        purpose: 'batch_read',
        when: 'ids is a non-empty array',
        method: 'POST',
        path: '/crm/v3/objects/{object_type}/batch/read',
        batch_size: 100,
      },
      {
        purpose: 'list',
        when: 'ids is absent or empty',
        method: 'GET',
        path: '/crm/v3/objects/{object_type}',
        max_page_size: 100,
      },
    ]);
    expect(Object.keys(extras.response_schemas ?? {}).sort()).toEqual(['batch_read', 'list']);
    const properties = (node.output_schema as { properties: Record<string, unknown> }).properties;
    expect(properties.mode).toMatchObject({ enum: ['batch_read', 'list'] });
  });
});

describe('hubspot-list_records-1', () => {
  it('reads the given ids through batch/read and says so', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.batch_read_contacts }));

    const output = await run({
      object_type: 'contacts',
      ids: ['51201', '51202'],
      properties: ['email'],
    });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/crm/v3/objects/contacts/batch/read');
    expect(calls[0]?.body).toEqual({
      inputs: [{ id: '51201' }, { id: '51202' }],
      properties: ['email'],
    });
    check_output_against_schema(output, node.output_schema);
    expect(output).toMatchObject({
      mode: 'batch_read',
      next_cursor: null,
      errors: [],
      records: [{ id: '51201' }, { id: '51202' }],
    });
  });

  it('passes id_property through so records can be read by email', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.batch_read_contacts }));

    await run({
      object_type: 'contacts',
      ids: ['maria.rossi@example.com'],
      id_property: 'email',
    });

    expect(calls[0]?.body).toMatchObject({ idProperty: 'email' });
  });

  it('reports ids HubSpot could not read without losing the ones it could', async () => {
    stub_hubspot_fetch(() => ({ status: 207, body: fixtures.batch_read_partly_missing }));

    const output = await run({ object_type: 'contacts', ids: ['51201', '99999999'] });

    expect(output).toMatchObject({ mode: 'batch_read', records: [{ id: '51201' }] });
    expect(output.errors[0]).toContain('may be deleted or not exist');
  });

  it('cuts more than 100 ids into 100-id batch calls', async () => {
    const ids = Array.from({ length: 250 }, (_entry, position) => `id_${position}`);
    const calls = stub_hubspot_fetch((call) => {
      const inputs = (call.body as { inputs: { id: string }[] }).inputs;
      return { body: { status: 'COMPLETE', results: inputs.map((input) => ({ id: input.id })) } };
    });

    const output = await run({ object_type: 'contacts', ids });

    expect(calls.map((call) => (call.body as { inputs: unknown[] }).inputs.length)).toEqual([
      100, 100, 50,
    ]);
    expect(output.records).toHaveLength(250);
    expect(output.records[249]?.id).toBe('id_249');
  });

  it('pages the whole object type through the plain list endpoint when no ids are given', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.list_contacts_page_one }));

    const output = await run({
      object_type: 'companies',
      properties: ['name', 'domain'],
      cursor: '51200',
      limit: 25,
    });

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toContain('/crm/v3/objects/companies?');
    expect(calls[0]?.url).toContain('properties=name%2Cdomain');
    expect(calls[0]?.url).toContain('after=51200');
    expect(calls[0]?.url).toContain('limit=25');
    check_output_against_schema(output, node.output_schema);
    expect(output).toMatchObject({ mode: 'list', next_cursor: '51202', errors: [] });
  });

  it('treats an empty ids array as the list mood', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.list_contacts_page_one }));

    const output = await run({ object_type: 'contacts', ids: [] });

    expect(calls[0]?.method).toBe('GET');
    expect(output.mode).toBe('list');
  });
});
