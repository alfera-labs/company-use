import app_definition from '@connectors/apps/attio/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/attio/create_note/v1/execute';
import fixtures from '@connectors/apps/attio/create_note/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/attio/create_note/v1/node.json' with { type: 'json' };
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
const missing_record_id = '00000000-0000-0000-0000-000000000000';

type RecordedCall = { method: string; url: string; body: unknown };

function stub_attio_fetch() {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: String(init.method), url: String(url), body });
      const missing = JSON.stringify(body).includes(missing_record_id);
      return new Response(
        JSON.stringify(missing ? fixtures.missing_record : fixtures.created_note),
        { status: missing ? 404 : 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
  const connection = { connection_id: 'conn_attio_fixture', access_token: 'token_attio' };
  const context: ConnectorNodeContext = {
    app,
    connection: { connection_id: connection.connection_id },
    send_request: (request) => send_connector_http_request({ app, connection, ...request }),
    send_request_for_response: (request) =>
      send_connector_http_response({ app, connection, ...request }),
    fan_out,
    log: create_logger('attio-create_note-test'),
  };
  return { context, calls };
}

beforeEach(() => reset_rate_limit_buckets());
afterEach(() => vi.unstubAllGlobals());

describe('attio-create_note-1 node.json', () => {
  it('names the key its own folder proves and asks for the note scope', () => {
    expect(definition.node_key).toBe('attio-create_note-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toContain('note:read-write');
    expect(definition.input_schema.required).toEqual(['object', 'record_id', 'content']);
  });
});

describe('attio-create_note-1 execute', () => {
  it('posts one plaintext note on the record and answers with the note id', async () => {
    const { context, calls } = stub_attio_fetch();
    const result = await execute(
      {
        object: 'people',
        record_id: '034743cf-f82f-42bd-b825-1e38f2531a4d',
        content:
          'Nadia Kowalski is associated with Quillstone.\nCame from email domain quillstone.io.',
      },
      context,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/notes');
    expect(calls[0]?.body).toEqual({
      data: {
        parent_object: 'people',
        parent_record_id: '034743cf-f82f-42bd-b825-1e38f2531a4d',
        title: 'Nadia Kowalski is associated with Quillstone.',
        format: 'plaintext',
        content:
          'Nadia Kowalski is associated with Quillstone.\nCame from email domain quillstone.io.',
      },
    });
    expect(result.note_id).toBe('2e6e29ea-c4e0-4f44-842d-78a891f8c156');
    expect(result.record_id).toBe('034743cf-f82f-42bd-b825-1e38f2531a4d');
  });

  it('keeps a title the run chose', async () => {
    const { context, calls } = stub_attio_fetch();
    await execute(
      { object: 'companies', record_id: 'abc', content: 'body', title: 'Lead intake' },
      context,
    );
    expect((calls[0]?.body as { data: { title: string } }).data.title).toBe('Lead intake');
  });

  it("passes Attio's own 404 through when the record does not exist", async () => {
    const { context } = stub_attio_fetch();
    await expect(
      execute({ object: 'people', record_id: missing_record_id, content: 'x' }, context),
    ).rejects.toThrow();
  });
});
