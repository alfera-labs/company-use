import app_definition from '@connectors/apps/gmail/app.json' with { type: 'json' };
import * as execute_module from '@connectors/apps/gmail/list_labels/v1/execute';
import fixtures from '@connectors/apps/gmail/list_labels/v1/fixtures.json' with { type: 'json' };
import node_definition from '@connectors/apps/gmail/list_labels/v1/node.json' with { type: 'json' };
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
import { create_logger } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

const app = load_connector_app('apps/gmail/app.json', app_definition);
const node = load_connector_node(
  'apps/gmail/list_labels/v1/node.json',
  node_definition,
  execute_module,
);

const connection: ConnectorConnection = {
  connection_id: 'conn_gmail_labels',
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
  log: create_logger('connectors-gmail-labels-test'),
};

function stub_gmail_fetch(body: unknown, status = 200) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return urls;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gmail-list_labels-1 definition', () => {
  it('declares the key its own folder proves, and the code that runs it', () => {
    expect(node.node_key).toBe('gmail-list_labels-1');
    expect(node.implementation).toBe('execute');
    expect(node.execute).toBe(execute);
    expect(node.required_scopes).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
  });

  it('takes the browse input and answers with the scope-option shape', () => {
    expect(Object.keys(node_definition.input_schema.properties)).toEqual([
      'parent_id',
      'query',
      'cursor',
      'limit',
    ]);
    expect(node_definition.output_schema.required).toEqual(['options', 'next_cursor']);
    expect(Object.keys(node_definition.output_schema.properties.options.items.properties)).toEqual([
      'id',
      'label',
      'sublabel',
      'preview',
      'kind',
      'has_children',
      'selectable',
    ]);
  });

  it('is the browse node the app labels dimension points at, beside a query dimension', () => {
    const [labels, search] = app_definition.sync.dimensions;
    expect(labels).toMatchObject({
      key: 'labels',
      shape: 'flat',
      browse_node: 'gmail-list_labels-1',
    });
    expect(search).toMatchObject({
      key: 'search',
      shape: 'query',
      browse_node: 'gmail-list_messages-1',
    });
    expect(search?.placeholder).toContain('newer_than');
    expect(search?.option_mapping?.selectable).toBe(false);
  });
});

describe('gmail-list_labels-1 execute', () => {
  it('maps the mailbox onto pickable options and hides CHAT and the inbox tabs', async () => {
    const urls = stub_gmail_fetch(fixtures.labels_list);

    const output = await execute({}, context);

    expect(output).toEqual({
      options: [
        { id: 'INBOX', label: 'INBOX', sublabel: 'System label', kind: 'label', selectable: true },
        { id: 'SENT', label: 'SENT', sublabel: 'System label', kind: 'label', selectable: true },
        { id: 'Label_17', label: 'Customers/Acme', kind: 'label', selectable: true },
        { id: 'Label_23', label: 'Invoices', kind: 'label', selectable: true },
      ],
      next_cursor: null,
    });
    expect(find_json_schema_violation(node.output_schema, output, 'output')).toBeNull();
    expect(urls).toEqual(['https://gmail.googleapis.com/gmail/v1/users/me/labels']);
  });

  it('keeps only the labels whose name contains the query, ignoring case', async () => {
    stub_gmail_fetch(fixtures.labels_list);

    const output = await execute({ query: 'acme' }, context);

    expect(output.options.map((option) => option.id)).toEqual(['Label_17']);
  });

  it('ignores parent_id, cursor and limit, because labels are one flat answer', async () => {
    stub_gmail_fetch(fixtures.labels_list);

    const output = await execute({ parent_id: 'INBOX', cursor: 'page_two', limit: 1 }, context);

    expect(output.options).toHaveLength(4);
    expect(output.next_cursor).toBeNull();
  });

  it('drops a label the fields mask returned without a name', async () => {
    stub_gmail_fetch(fixtures.labels_list_sparse);

    const output = await execute({}, context);

    expect(output.options).toEqual([
      { id: 'Label_31', label: 'Board', kind: 'label', selectable: true },
    ]);
  });

  it('turns a refused scope into a typed error, not a retry storm', async () => {
    const urls = stub_gmail_fetch(fixtures.labels_list_forbidden, 403);

    await expect(execute({}, context)).rejects.toMatchObject({ retryable: false, status: 403 });
    expect(urls).toHaveLength(1);
  });
});
