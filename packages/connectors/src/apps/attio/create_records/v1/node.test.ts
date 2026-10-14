import app_definition from '@connectors/apps/attio/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/attio/create_records/v1/execute';
import fixtures from '@connectors/apps/attio/create_records/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/attio/create_records/v1/node.json' with { type: 'json' };
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

const conflicting_domain = 'taken.com';

type RecordedCall = { method: string; url: string; body: unknown };

function stub_attio_fetch() {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: String(init.method), url: String(url), body });
      const conflicted = JSON.stringify(body).includes(conflicting_domain);
      return new Response(
        JSON.stringify(conflicted ? fixtures.unique_attribute_conflict : fixtures.created_company),
        { status: conflicted ? 400 : 200, headers: { 'Content-Type': 'application/json' } },
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
    log: create_logger('attio-create_records-test'),
  };
  return { context, calls };
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attio-create_records-1 node.json', () => {
  it('names the key its own folder proves', () => {
    expect(definition.node_key).toBe('attio-create_records-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.description.length).toBeGreaterThan(0);
    expect(definition.required_scopes).toEqual([
      'record_permission:read-write',
      'object_configuration:read',
    ]);
  });

  it('takes an array of records and bounds the batch', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.input_schema.properties.records.type).toBe('array');
    expect(definition.input_schema.properties.records.minItems).toBe(1);
    expect(definition.input_schema.properties.records.maxItems).toBe(200);
    expect(definition.output_schema.properties.results.type).toBe('array');
  });
});

describe('attio-create_records-1 execute', () => {
  it('sends one create per record and maps the written record back', async () => {
    const { context, calls } = stub_attio_fetch();

    const output = await execute(
      {
        object: 'companies',
        records: [{ values: { name: 'Attio', domains: ['attio.com'] } }],
      },
      context,
    );

    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.attio.com/v2/objects/companies/records',
        body: { data: { values: { name: 'Attio', domains: ['attio.com'] } } },
      },
    ]);
    expect(output).toEqual({
      results: [
        {
          ok: true,
          index: 0,
          record: {
            record_id: '891dcbfc-9141-415d-9b2a-2238a6cc012d',
            object_id: '97052eb9-e65e-443f-a297-f2d9a4a7f795',
            workspace_id: '14beef7a-99f7-4534-a87e-70b564330a4c',
            created_at: '2026-09-05T10:14:02.000000000Z',
            web_url: 'https://app.attio.com/salarya/company/891dcbfc-9141-415d-9b2a-2238a6cc012d',
            attributes: { name: ['Attio'], domains: ['attio.com'] },
            values: fixtures.created_company.data.values,
          },
        },
      ],
    });
  });

  it('keeps the records that worked when one hits a unique attribute conflict', async () => {
    const { context, calls } = stub_attio_fetch();

    const output = await execute(
      {
        object: 'companies',
        records: [
          { values: { domains: ['attio.com'] } },
          { values: { domains: [conflicting_domain] } },
          { values: { domains: ['fine.com'] } },
        ],
      },
      context,
    );

    expect(calls).toHaveLength(3);
    expect(output.results.map((result) => [result.index, result.ok])).toEqual([
      [0, true],
      [1, false],
      [2, true],
    ]);
    const failed = output.results[1];
    if (failed?.ok !== false) throw new Error('expected the conflicting record to fail');
    expect(failed.error.code).toBe('provider_error');
    expect(failed.error.retryable).toBe(false);
    expect(failed.error.message).toContain('value_not_unique');
  });
});
