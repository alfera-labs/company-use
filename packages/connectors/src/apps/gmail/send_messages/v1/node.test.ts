import app_definition from '@connectors/apps/gmail/app.json' with { type: 'json' };
import * as execute_module from '@connectors/apps/gmail/send_messages/v1/execute';
import fixtures from '@connectors/apps/gmail/send_messages/v1/fixtures.json' with { type: 'json' };
import node_definition from '@connectors/apps/gmail/send_messages/v1/node.json' with {
  type: 'json',
};
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_app, load_connector_node } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type {
  ConnectorConnection,
  ConnectorNodeContext,
  ConnectorNodeRequest,
} from '@connectors/types';
import { create_logger, type JsonSchema } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

const app = load_connector_app('apps/gmail/app.json', app_definition);

const connection: ConnectorConnection = {
  connection_id: 'conn_gmail_fixture',
  access_token: 'token_gmail',
};

const context: ConnectorNodeContext = {
  app,
  connection: { connection_id: connection.connection_id },
  send_request: <TParsed>(request: ConnectorNodeRequest): Promise<TParsed> =>
    send_connector_http_request<TParsed>({ app, connection, ...request }),
  send_request_for_response: <TParsed>(request: ConnectorNodeRequest) =>
    send_connector_http_response<TParsed>({ app, connection, ...request }),
  fan_out,
  log: create_logger('connectors-gmail-test'),
};

type SentRequest = { url: string; init: RequestInit };

function json_response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stub_gmail_fetch(answer: (call_count: number) => Response) {
  const requests: SentRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return answer(requests.length);
    }),
  );
  return requests;
}

function decode_sent_email(request: SentRequest | undefined) {
  const body = JSON.parse(String(request?.init.body)) as { raw: string };
  return Buffer.from(body.raw, 'base64url').toString('utf8');
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gmail-send_messages-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    const loaded = load_connector_node(
      'apps/gmail/send_messages/v1/node.json',
      node_definition,
      execute_module,
    );
    expect(loaded.node_key).toBe(node_definition.node_key);
    expect(loaded.execute).toBe(execute);
  });

  it('declares the key its own folder proves, and the code it needs', () => {
    expect(node_definition.node_key).toBe('gmail-send_messages-1');
    expect(node_definition.implementation).toBe('execute');
    expect(node_definition.required_scopes).toEqual(['https://www.googleapis.com/auth/gmail.send']);
    expect(node_definition.quirks.provider_endpoints).toEqual(['POST /users/me/messages/send']);
  });

  it('takes an array of messages and answers one result per message', () => {
    const messages_schema = node_definition.input_schema.properties.messages;
    expect(messages_schema.type).toBe('array');
    expect(messages_schema.minItems).toBe(1);
    expect(messages_schema.items.required).toEqual(['to', 'subject', 'body_text']);
    const results = node_definition.output_schema.properties.results.items.oneOf;
    expect(results.map((variant) => variant.properties.ok.const)).toEqual([true, false]);
  });

  it('refuses a line break in every header field, in the schema itself', () => {
    const injection = 'Hello\r\nBcc: everyone@acme.test';
    const subject_pattern = new RegExp(
      node_definition.input_schema.properties.messages.items.properties.subject.pattern,
      'u',
    );
    const address_pattern = new RegExp(
      node_definition.input_schema.$defs.header_safe_address.pattern,
      'u',
    );
    expect(subject_pattern.test(injection)).toBe(false);
    expect(subject_pattern.test('Q3 numbers')).toBe(true);
    expect(address_pattern.test(injection)).toBe(false);
    expect(address_pattern.test('Ana Sample <ana@acme.test>')).toBe(true);
  });

  it('accepts the recorded send answers against its own schema', () => {
    const schema = node_definition.response_schema as JsonSchema;
    expect(find_json_schema_violation(schema, fixtures.sent_message_first, 'response')).toBeNull();
    expect(find_json_schema_violation(schema, fixtures.sent_message_second, 'response')).toBeNull();
    expect(
      find_json_schema_violation(schema, fixtures.send_recipient_rejected, 'response'),
    ).not.toBeNull();
  });
});

describe('gmail-send_messages-1 execute', () => {
  it('builds an RFC 2822 message per item and reports each id', async () => {
    const requests = stub_gmail_fetch((call_count) =>
      json_response(call_count === 1 ? fixtures.sent_message_first : fixtures.sent_message_second),
    );

    const output = await execute(
      {
        messages: [
          {
            to: ['ana@acme.test', 'marta@acme.test'],
            cc: ['finance@acme.test'],
            subject: 'Q3 numbers',
            body_text: 'Sending them over now.\n',
          },
          { to: ['ana@acme.test'], subject: 'Follow up', body_text: 'And the appendix.' },
        ],
      },
      context,
    );

    expect(output).toEqual({
      results: [
        { ok: true, index: 0, id: '18f4b2d0c3e51101', thread_id: '18f4b2d0c3e51101' },
        { ok: true, index: 1, id: '18f4b2d0c3e51102', thread_id: '18f4b2d0c3e51102' },
      ],
    });

    expect(requests[0]?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(decode_sent_email(requests[0])).toBe(
      [
        'To: ana@acme.test, marta@acme.test',
        'Cc: finance@acme.test',
        'Subject: Q3 numbers',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('Sending them over now.\n', 'utf8').toString('base64'),
        '',
      ].join('\r\n'),
    );
    expect(decode_sent_email(requests[1])).not.toContain('Cc:');
  });

  it('encodes a non-ASCII subject as an RFC 2047 word and keeps the body readable', async () => {
    const requests = stub_gmail_fetch(() => json_response(fixtures.sent_message_first));

    await execute(
      {
        messages: [{ to: ['ana@acme.test'], subject: 'Präventivmaßnahme ✅', body_text: 'Grüße' }],
      },
      context,
    );

    const email = decode_sent_email(requests[0]);
    expect(email).toContain(
      `Subject: =?UTF-8?B?${Buffer.from('Präventivmaßnahme ✅', 'utf8').toString('base64')}?=`,
    );
    const body_line = email.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body_line, 'base64').toString('utf8')).toBe('Grüße');
  });

  it('reports one rejected message without losing the others', async () => {
    stub_gmail_fetch((call_count) =>
      call_count === 2
        ? json_response(fixtures.send_recipient_rejected, 400)
        : json_response(fixtures.sent_message_first),
    );

    const output = await execute(
      {
        messages: [
          { to: ['ana@acme.test'], subject: 'Fine', body_text: 'ok' },
          { to: ['broken@acme.test'], subject: 'Rejected', body_text: 'ok' },
        ],
      },
      context,
    );

    expect(output.results[0]).toMatchObject({ ok: true, index: 0 });
    expect(output.results[1]).toMatchObject({
      ok: false,
      index: 1,
      error: { code: 'provider_error', retryable: false },
    });
  });

  it('refuses a header that carries a line break before any message is sent', async () => {
    const requests = stub_gmail_fetch(() => json_response(fixtures.sent_message_first));

    await expect(
      execute(
        {
          messages: [
            { to: ['ana@acme.test'], subject: 'Fine', body_text: 'ok' },
            {
              to: ['ana@acme.test'],
              subject: 'Hello\r\nBcc: everyone@acme.test',
              body_text: 'ok',
            },
          ],
        },
        context,
      ),
    ).rejects.toThrow(/must not contain a line break/u);
    expect(requests).toHaveLength(0);
  });
});
