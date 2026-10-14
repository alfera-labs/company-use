import app_definition from '@connectors/apps/attio/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/attio/update_records/v1/execute';
import fixtures from '@connectors/apps/attio/update_records/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/attio/update_records/v1/node.json' with { type: 'json' };
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

const present_record_id = '891dcbfc-9141-415d-9b2a-2238a6cc012d';
const missing_record_id = '00000000-0000-4000-8000-000000000000';

type RecordedCall = { method: string; url: string; body: unknown };

function stub_attio_fetch() {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: RequestInit) => {
      const address = String(url);
      calls.push({
        method: String(init.method),
        url: address,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const missing = address.endsWith(missing_record_id);
      return new Response(
        JSON.stringify(missing ? fixtures.record_not_found : fixtures.updated_company),
        { status: missing ? 404 : 200, headers: { 'Content-Type': 'application/json' } },
      );
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
    log: create_logger('attio-update_records-test'),
  };
  return { context, calls };
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attio-update_records-1 node.json', () => {
  it('names the key its own folder proves', () => {
    expect(definition.node_key).toBe('attio-update_records-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual([
      'record_permission:read-write',
      'object_configuration:read',
    ]);
  });

  it('takes an array of records with their ids and defaults to appending multiselect values', () => {
    const records = definition.input_schema.properties.records;
    expect(records.type).toBe('array');
    expect(records.items.required).toEqual(['record_id', 'values']);
    expect(records.minItems).toBe(1);
    expect(records.maxItems).toBe(200);
    expect(definition.input_schema.properties.multiselect_mode.default).toBe('append');
    expect(definition.input_schema.properties.multiselect_mode.enum).toEqual([
      'append',
      'overwrite',
    ]);
  });
});

describe('attio-update_records-1 execute', () => {
  it('appends multiselect values with PATCH', async () => {
    const { context, calls } = stub_attio_fetch();

    const output = await execute(
      {
        object: 'companies',
        multiselect_mode: 'append',
        records: [{ record_id: present_record_id, values: { name: 'Attio Inc.' } }],
      },
      context,
    );

    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: `https://api.attio.com/v2/objects/companies/records/${present_record_id}`,
        body: { data: { values: { name: 'Attio Inc.' } } },
      },
    ]);
    expect(output.results[0]).toEqual({
      ok: true,
      index: 0,
      record: {
        record_id: present_record_id,
        object_id: '97052eb9-e65e-443f-a297-f2d9a4a7f795',
        workspace_id: '14beef7a-99f7-4534-a87e-70b564330a4c',
        created_at: '2026-09-05T10:14:02.000000000Z',
        web_url: `https://app.attio.com/salarya/company/${present_record_id}`,
        attributes: { name: ['Attio Inc.'], categories: ['B2B'] },
        values: fixtures.updated_company.data.values,
      },
    });
  });

  it('overwrites multiselect values with PUT when asked', async () => {
    const { context, calls } = stub_attio_fetch();

    await execute(
      {
        object: 'companies',
        multiselect_mode: 'overwrite',
        records: [{ record_id: present_record_id, values: { categories: [] } }],
      },
      context,
    );

    expect(calls[0]?.method).toBe('PUT');
  });

  it('keeps the records that worked when one record id is gone', async () => {
    const { context } = stub_attio_fetch();

    const output = await execute(
      {
        object: 'companies',
        multiselect_mode: 'append',
        records: [
          { record_id: present_record_id, values: { name: 'Attio Inc.' } },
          { record_id: missing_record_id, values: { name: 'Nobody' } },
        ],
      },
      context,
    );

    expect(output.results.map((result) => [result.index, result.ok])).toEqual([
      [0, true],
      [1, false],
    ]);
    const failed = output.results[1];
    if (failed?.ok !== false) throw new Error('expected the missing record to fail');
    expect(failed.error.message).toContain('not_found');
  });
});
