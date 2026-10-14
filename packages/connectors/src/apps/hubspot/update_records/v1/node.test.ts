import {
  build_hubspot_context,
  check_node_definition,
  check_output_against_schema,
  load_hubspot_node,
  type NodeQuirks,
  stub_hubspot_fetch,
} from '@connectors/apps/hubspot/__tests__/hubspot_test_support';
import type {
  UpdateRecordsInput,
  UpdateRecordsOutput,
} from '@connectors/apps/hubspot/update_records/v1/execute';
import * as execute_module from '@connectors/apps/hubspot/update_records/v1/execute';
import fixtures from '@connectors/apps/hubspot/update_records/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/hubspot/update_records/v1/node.json' with { type: 'json' };
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const node = load_hubspot_node('update_records', definition, execute_module);
const extras = node as unknown as NodeQuirks;

function run(input: UpdateRecordsInput) {
  return execute_module.execute(input, build_hubspot_context()) as Promise<UpdateRecordsOutput>;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot-update_records-1 node.json', () => {
  it('declares the batch endpoint and the match-by-id quirk', () => {
    check_node_definition(node, 'hubspot-update_records-1');
    expect(node.implementation).toBe('execute');
    expect(extras.endpoints).toEqual([
      {
        purpose: 'batch_update',
        method: 'POST',
        path: '/crm/v3/objects/{object_type}/batch/update',
        batch_size: 100,
      },
    ]);
    expect(extras.quirks.join(' ')).toContain('by id, not by position');
    const properties = (node.output_schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(['failed_count', 'results', 'updated_count']);
  });
});

describe('hubspot-update_records-1', () => {
  it('sends one batch/update call and maps the answer back by id', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.batch_update_complete }));

    const output = await run({
      object_type: 'contacts',
      records: [
        { id: '51201', properties: { lifecyclestage: 'customer' } },
        { id: '51202', properties: { lifecyclestage: 'customer' } },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/crm/v3/objects/contacts/batch/update');
    expect(calls[0]?.body).toEqual({
      inputs: [
        { id: '51201', properties: { lifecyclestage: 'customer' } },
        { id: '51202', properties: { lifecyclestage: 'customer' } },
      ],
    });
    check_output_against_schema(output, node.output_schema);
    expect(output).toMatchObject({
      updated_count: 2,
      failed_count: 0,
      results: [
        { index: 0, ok: true, record: { id: '51201' } },
        { index: 1, ok: true, record: { id: '51202' } },
      ],
    });
  });

  it('names exactly which record did not update in a partly failed batch', async () => {
    stub_hubspot_fetch(() => ({ status: 207, body: fixtures.batch_update_partly_missing }));

    const output = await run({
      object_type: 'contacts',
      records: [
        { id: '51201', properties: { lifecyclestage: 'customer' } },
        { id: '51202', properties: { lifecyclestage: 'customer' } },
      ],
    });

    expect(output.updated_count).toBe(1);
    expect(output.failed_count).toBe(1);
    expect(output.results[0]).toMatchObject({ index: 0, ok: true });
    const second = output.results[1];
    expect(second?.ok === false && second.error).toContain('did not update 51202');
  });

  it('matches by id even when HubSpot answers out of input order', async () => {
    stub_hubspot_fetch(() => ({
      body: { status: 'COMPLETE', results: [{ id: '51202' }, { id: '51201' }] },
    }));

    const output = await run({
      object_type: 'contacts',
      records: [
        { id: '51201', properties: { city: 'Milan' } },
        { id: '51202', properties: { city: 'Lagos' } },
      ],
    });

    const [first, second] = output.results;
    expect(first?.ok === true && first.record.id).toBe('51201');
    expect(second?.ok === true && second.record.id).toBe('51202');
  });

  it('passes id_property through so records can be addressed by email', async () => {
    const calls = stub_hubspot_fetch(() => ({
      body: { status: 'COMPLETE', results: [{ id: 'maria.rossi@example.com' }] },
    }));

    await run({
      object_type: 'contacts',
      id_property: 'email',
      records: [{ id: 'maria.rossi@example.com', properties: { lifecyclestage: 'customer' } }],
    });

    expect(calls[0]?.body).toMatchObject({ idProperty: 'email' });
  });

  it('cuts more than 100 records into 100-record batch calls and keeps the caller indexes', async () => {
    const records = Array.from({ length: 230 }, (_entry, position) => ({
      id: `id_${position}`,
      properties: { lifecyclestage: 'customer' },
    }));
    const calls = stub_hubspot_fetch((call) => {
      const inputs = (call.body as { inputs: { id: string }[] }).inputs;
      return { body: { status: 'COMPLETE', results: inputs.map((input) => ({ id: input.id })) } };
    });

    const output = await run({ object_type: 'contacts', records });

    expect(calls.map((call) => (call.body as { inputs: unknown[] }).inputs.length)).toEqual([
      100, 100, 30,
    ]);
    expect(output.updated_count).toBe(230);
    expect(output.results[229]).toMatchObject({ index: 229, ok: true, record: { id: 'id_229' } });
  });
});
