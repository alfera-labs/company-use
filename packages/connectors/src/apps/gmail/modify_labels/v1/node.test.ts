import app_definition from '@connectors/apps/gmail/app.json' with { type: 'json' };
import * as execute_module from '@connectors/apps/gmail/modify_labels/v1/execute';
import fixtures from '@connectors/apps/gmail/modify_labels/v1/fixtures.json' with { type: 'json' };
import node_definition from '@connectors/apps/gmail/modify_labels/v1/node.json' with {
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

function stub_gmail_fetch(answer: () => Response) {
  const requests: SentRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return answer();
    }),
  );
  return requests;
}

function empty_success_response() {
  return new Response(null, { status: fixtures.batch_modify_success.status });
}

function json_response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gmail-modify_labels-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    const loaded = load_connector_node(
      'apps/gmail/modify_labels/v1/node.json',
      node_definition,
      execute_module,
    );
    expect(loaded.node_key).toBe(node_definition.node_key);
    expect(loaded.execute).toBe(execute);
    expect(loaded.atomic).toBe(true);
  });

  it('declares the key its own folder proves, and the real batch endpoint', () => {
    expect(node_definition.node_key).toBe('gmail-modify_labels-1');
    expect(node_definition.atomic).toBe(true);
    expect(node_definition.required_scopes).toEqual([
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
  });

  it('caps the batch at the 1000 ids Gmail allows and refuses a call that changes nothing', () => {
    expect(node_definition.input_schema.properties.message_ids.maxItems).toBe(1000);
    expect(node_definition.input_schema.properties.message_ids.minItems).toBe(1);
    expect(node_definition.input_schema.anyOf).toEqual([
      { required: ['add_label_ids'] },
      { required: ['remove_label_ids'] },
    ]);
    expect(node_definition.input_schema.properties.add_label_ids.minItems).toBe(1);
    expect(node_definition.input_schema.properties.remove_label_ids.minItems).toBe(1);
  });

  it('says out loud that success carries no body', () => {
    expect(node_definition.response_schema.type).toBe('null');
    expect(fixtures.batch_modify_success).toEqual({ status: 204, body: '' });
    const schema = node_definition.response_schema as JsonSchema;
    expect(find_json_schema_violation(schema, null, 'response')).toBeNull();
    expect(find_json_schema_violation(schema, { ok: true }, 'response')).not.toBeNull();
  });

  it('declares the endpoint execute.ts calls, and why it is not an http mapping', () => {
    expect(node_definition.quirks.endpoint).toEqual({
      method: 'POST',
      path: '/users/me/messages/batchModify',
    });
    expect(node_definition.quirks.why_execute).toContain('204');
  });
});

describe('gmail-modify_labels-1 execute', () => {
  it('changes every message in ONE call to the real batch endpoint', async () => {
    const requests = stub_gmail_fetch(empty_success_response);

    const output = await execute(
      {
        message_ids: fixtures.batch_modify_request.ids,
        add_label_ids: fixtures.batch_modify_request.addLabelIds,
        remove_label_ids: fixtures.batch_modify_request.removeLabelIds,
      },
      context,
    );

    expect(output).toEqual({ modified_message_ids: fixtures.batch_modify_request.ids });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `${app_definition.base_url}${node_definition.quirks.endpoint.path}`,
    );
    expect(requests[0]?.init.method).toBe(node_definition.quirks.endpoint.method);
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual(fixtures.batch_modify_request);
  });

  it('sends only the label list the caller gave', async () => {
    const requests = stub_gmail_fetch(empty_success_response);

    await execute({ message_ids: ['18f3a1c9b2d40011'], remove_label_ids: ['UNREAD'] }, context);

    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      ids: ['18f3a1c9b2d40011'],
      removeLabelIds: ['UNREAD'],
    });
  });

  it('surfaces an unknown label as a failure instead of a silent success', async () => {
    stub_gmail_fetch(() => json_response(fixtures.batch_modify_unknown_label, 400));

    await expect(
      execute({ message_ids: ['18f3a1c9b2d40011'], add_label_ids: ['Label_999'] }, context),
    ).rejects.toThrow(/Invalid label: Label_999/u);
  });

  it('surfaces a missing gmail.modify scope as unauthorized', async () => {
    stub_gmail_fetch(() => json_response(fixtures.batch_modify_insufficient_scope, 403));

    await expect(
      execute({ message_ids: ['18f3a1c9b2d40011'], add_label_ids: ['STARRED'] }, context),
    ).rejects.toThrow(/refused the connection/u);
  });
});
