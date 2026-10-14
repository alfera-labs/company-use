import {
  build_hubspot_context,
  check_node_definition,
  check_output_against_schema,
  load_hubspot_node,
  type NodeQuirks,
  stub_hubspot_fetch,
} from '@connectors/apps/hubspot/__tests__/hubspot_test_support';
import type {
  CreateRecordsInput,
  CreateRecordsOutput,
} from '@connectors/apps/hubspot/create_records/v1/execute';
import * as execute_module from '@connectors/apps/hubspot/create_records/v1/execute';
import fixtures from '@connectors/apps/hubspot/create_records/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/hubspot/create_records/v1/node.json' with { type: 'json' };
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const node = load_hubspot_node('create_records', definition, execute_module);
const extras = node as unknown as NodeQuirks;

function run(input: CreateRecordsInput) {
  return execute_module.execute(input, build_hubspot_context()) as Promise<CreateRecordsOutput>;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot-create_records-1 node.json', () => {
  it('declares the batch endpoint, its size, and the partial-failure quirk', () => {
    check_node_definition(node, 'hubspot-create_records-1');
    expect(node.implementation).toBe('execute');
    expect(extras.endpoints).toEqual([
      {
        purpose: 'batch_create',
        method: 'POST',
        path: '/crm/v3/objects/{object_type}/batch/create',
        batch_size: 100,
      },
    ]);
    expect(node.required_scopes).toEqual([
      'crm.objects.contacts.write',
      'crm.objects.companies.write',
      'crm.objects.deals.write',
    ]);
    expect(extras.quirks.join(' ')).toContain('unmapped_records');
  });
});

describe('hubspot-create_records-1', () => {
  it('sends one batch/create call and maps the answer back in input order', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.batch_create_complete }));

    const output = await run({
      object_type: 'contacts',
      records: [
        { properties: { email: 'nina.haas@example.com', firstname: 'Nina', lastname: 'Haas' } },
        { properties: { email: 'tom.li@example.com', firstname: 'Tom', lastname: 'Li' } },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/crm/v3/objects/contacts/batch/create');
    expect(calls[0]?.body).toEqual({
      inputs: [
        { properties: { email: 'nina.haas@example.com', firstname: 'Nina', lastname: 'Haas' } },
        { properties: { email: 'tom.li@example.com', firstname: 'Tom', lastname: 'Li' } },
      ],
    });
    check_output_against_schema(output, node.output_schema);
    expect(output).toMatchObject({
      created_count: 2,
      failed_count: 0,
      unmapped_records: [],
      results: [
        { index: 0, ok: true, record: { id: '60011' } },
        { index: 1, ok: true, record: { id: '60012' } },
      ],
    });
  });

  it('accepts an answer carrying a field HubSpot has not shipped yet', async () => {
    stub_hubspot_fetch(() => ({
      body: {
        status: 'COMPLETE',
        requestId: 'req_a1b2c3',
        results: [{ id: '60011', properties: {}, sourceLabel: 'API' }],
      },
    }));

    const output = await run({
      object_type: 'contacts',
      records: [{ properties: { email: 'nina.haas@example.com' } }],
    });

    expect(output.created_count).toBe(1);
  });

  it('keeps numbers and booleans as they were written', async () => {
    const calls = stub_hubspot_fetch(() => ({
      body: { status: 'COMPLETE', results: [{ id: '70001' }] },
    }));

    await run({
      object_type: 'deals',
      records: [{ properties: { amount: 1250.5, dealname: 'Q4 renewal', hs_is_closed: false } }],
    });

    expect(calls[0]?.body).toEqual({
      inputs: [{ properties: { amount: 1250.5, dealname: 'Q4 renewal', hs_is_closed: false } }],
    });
  });

  it('fails every record of a partly rejected batch and keeps what HubSpot did create', async () => {
    stub_hubspot_fetch(() => ({ status: 207, body: fixtures.batch_create_partly_rejected }));

    const output = await run({
      object_type: 'contacts',
      records: [
        { properties: { email: 'nina.haas@example.com' } },
        { properties: { email: 'not-an-email' } },
      ],
    });

    check_output_against_schema(output, node.output_schema);
    expect(output.created_count).toBe(0);
    expect(output.failed_count).toBe(2);
    expect(output.unmapped_records).toMatchObject([{ id: '60013' }]);
    const first = output.results[0];
    expect(first?.ok).toBe(false);
    expect(first?.ok === false && first.error).toContain('created 1 of 2 records');
    expect(first?.ok === false && first.error).toContain('INVALID_EMAIL');
    expect(output.results.map((result) => result.index)).toEqual([0, 1]);
  });

  it('cuts more than 100 records into 100-record batch calls and keeps the caller indexes', async () => {
    const records = Array.from({ length: 150 }, (_entry, position) => ({
      properties: { email: `person_${position}@example.com` },
    }));
    const calls = stub_hubspot_fetch((call) => {
      const inputs = (call.body as { inputs: { properties: { email: string } }[] }).inputs;
      return {
        body: {
          status: 'COMPLETE',
          results: inputs.map((input) => ({ id: input.properties.email })),
        },
      };
    });

    const output = await run({ object_type: 'contacts', records });

    expect(calls.map((call) => (call.body as { inputs: unknown[] }).inputs.length)).toEqual([
      100, 50,
    ]);
    expect(output.created_count).toBe(150);
    expect(output.results[149]).toEqual({
      index: 149,
      ok: true,
      record: {
        id: 'person_149@example.com',
        properties: {},
        created_at: null,
        updated_at: null,
        archived: false,
      },
    });
  });

  it('loses no other chunk when one chunk request fails outright', async () => {
    const records = Array.from({ length: 150 }, (_entry, position) => ({
      properties: { email: `person_${position}@example.com` },
    }));
    stub_hubspot_fetch((call) => {
      const inputs = (call.body as { inputs: { properties: { email: string } }[] }).inputs;
      if (inputs[0]?.properties.email === 'person_0@example.com') {
        return { status: 400, body: { message: 'Invalid input JSON' } };
      }
      return {
        body: {
          status: 'COMPLETE',
          results: inputs.map((input) => ({ id: input.properties.email })),
        },
      };
    });

    const output = await run({ object_type: 'contacts', records });

    expect(output.failed_count).toBe(100);
    expect(output.created_count).toBe(50);
    expect(output.results[100]).toMatchObject({ index: 100, ok: true });
  });
});
