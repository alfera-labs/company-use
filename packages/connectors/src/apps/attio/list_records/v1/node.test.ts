import app_definition from '@connectors/apps/attio/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/attio/list_records/v1/execute';
import fixtures from '@connectors/apps/attio/list_records/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/attio/list_records/v1/node.json' with { type: 'json' };
import { load_connector_app } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorNodeContext } from '@connectors/types';
import { create_logger } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = load_connector_app('apps/attio/app.json', app_definition);

type RecordedCall = { method: string; url: string; body: unknown };

function stub_attio_fetch(payload: unknown) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: RequestInit) => {
      calls.push({
        method: String(init.method),
        url: String(url),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  const context: ConnectorNodeContext = {
    app,
    connection: { connection_id: 'conn_attio_fixture' },
    send_request: (request) =>
      send_connector_http_request({
        app,
        connection: { connection_id: 'conn_attio_fixture', access_token: 'token_attio' },
        ...request,
      }),
    send_request_for_response: (request) =>
      send_connector_http_response({
        app,
        connection: { connection_id: 'conn_attio_fixture', access_token: 'token_attio' },
        ...request,
      }),
    fan_out,
    log: create_logger('attio-list_records-test'),
  };
  return { context, calls };
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attio-list_records-1 node.json', () => {
  it('names the key its own folder proves', () => {
    expect(definition.node_key).toBe('attio-list_records-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.description.length).toBeGreaterThan(0);
    expect(definition.required_scopes).toEqual([
      'record_permission:read',
      'object_configuration:read',
    ]);
  });

  it('declares plural JSON Schema draft 2020-12 contracts on both sides', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.response_schema.$schema).toBe(draft);
    expect(definition.output_schema.properties.records.type).toBe('array');
    expect(definition.output_schema.properties.next_cursor).toBeDefined();
    expect(definition.input_schema.properties.limit.default).toBe(100);
    expect(definition.input_schema.properties.limit.maximum).toBe(500);
    expect(definition.input_schema.properties.cursor.pattern).toBe('^\\d+$');
    expect(definition.input_schema.required).toEqual(['object']);
  });
});

describe('attio-list_records-1 execute', () => {
  it('queries the object and sends the page window in the body', async () => {
    const { context, calls } = stub_attio_fetch(fixtures.list_records_full_page);

    await execute(
      {
        object: 'companies',
        filter: { name: 'Ada Lovelace' },
        sorts: [{ direction: 'desc', attribute: 'created_at' }],
        cursor: '40',
        limit: 20,
      },
      context,
    );

    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.attio.com/v2/objects/companies/records/query',
        body: {
          filter: { name: 'Ada Lovelace' },
          sorts: [{ direction: 'desc', attribute: 'created_at' }],
          limit: 20,
          offset: 40,
        },
      },
    ]);
  });

  it('reads a page into readable attributes and keeps the raw Attio values', async () => {
    const { context } = stub_attio_fetch(fixtures.list_records_full_page);

    const output = await execute({ object: 'people', limit: 2 }, context);

    expect(output.records[0]).toEqual({
      record_id: 'bf071e1f-6035-429d-b874-d83ea64ea13b',
      object_id: '97052eb9-e65e-443f-a297-f2d9a4a7f795',
      workspace_id: '14beef7a-99f7-4534-a87e-70b564330a4c',
      created_at: '2022-11-21T13:22:49.061281000Z',
      web_url: 'https://app.attio.com/salarya/person/bf071e1f-6035-429d-b874-d83ea64ea13b',
      attributes: {
        name: ['Ada Lovelace'],
        email_addresses: ['ada@lovelace.com'],
        job_title: ['Mathematician'],
      },
      values: fixtures.list_records_full_page.data[0]?.values,
    });
    expect(output.records[1]?.attributes).toEqual({
      domains: ['attio.com'],
      categories: ['B2B'],
      employee_count: [120],
    });
  });

  it('hands back the next offset as a cursor when the page is full', async () => {
    const { context } = stub_attio_fetch(fixtures.list_records_full_page);

    const output = await execute({ object: 'people', cursor: '10', limit: 2 }, context);

    expect(output.next_cursor).toBe('12');
  });

  it('reports the end of the object as a null cursor', async () => {
    const { context } = stub_attio_fetch(fixtures.list_records_last_page);

    const output = await execute({ object: 'people', cursor: '12', limit: 2 }, context);

    expect(output.next_cursor).toBeNull();
  });

  it('reads an attribute type it has never seen as null and still keeps its raw value', async () => {
    const { context } = stub_attio_fetch(fixtures.list_records_last_page);

    const output = await execute({ object: 'people', limit: 2 }, context);

    expect(output.records[0]?.attributes.loyalty_program).toEqual([null]);
    expect(output.records[0]?.values.loyalty_program).toEqual([
      {
        active_from: '2023-06-18T18:45:12.000000000Z',
        active_until: null,
        created_by_actor: { type: 'system', id: null },
        attribute_type: 'membership-tier',
        tier_label: 'Gold',
      },
    ]);
  });

  it('reads an empty object as no records and no cursor', async () => {
    const { context } = stub_attio_fetch(fixtures.list_records_empty_page);

    const output = await execute({ object: 'deals', limit: 100 }, context);

    expect(output).toEqual({ records: [], next_cursor: null });
  });
});
