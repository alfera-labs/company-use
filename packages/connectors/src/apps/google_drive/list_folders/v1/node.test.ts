import app_definition from '@connectors/apps/google_drive/app.json' with { type: 'json' };
import * as execute_module from '@connectors/apps/google_drive/list_folders/v1/execute';
import { execute } from '@connectors/apps/google_drive/list_folders/v1/execute';
import fixtures from '@connectors/apps/google_drive/list_folders/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/google_drive/list_folders/v1/node.json' with {
  type: 'json',
};
import { load_connector_app, load_connector_node } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  ConnectorHttpError,
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorConnection, ConnectorNodeContext } from '@connectors/types';
import { create_logger } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = load_connector_app('apps/google_drive/app.json', app_definition);
const node = load_connector_node(
  'apps/google_drive/list_folders/v1/node.json',
  definition,
  execute_module,
);

const connection: ConnectorConnection = {
  connection_id: 'conn_google_drive_folders',
  access_token: 'token_redacted',
};

const requested_urls: string[] = [];

const context: ConnectorNodeContext = {
  app,
  connection: { connection_id: connection.connection_id },
  send_request: (request) => send_connector_http_request({ app, connection, ...request }),
  send_request_for_response: (request) =>
    send_connector_http_response({ app, connection, ...request }),
  fan_out,
  log: create_logger('connectors_test'),
};

function stub_fetch_with(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested_urls.push(url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function last_request_parameters() {
  return new URL(requested_urls[requested_urls.length - 1] as string).searchParams;
}

beforeEach(() => {
  reset_rate_limit_buckets();
  requested_urls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('google_drive-list_folders-1 definition', () => {
  it('declares the key its own folder proves, and the code that runs it', () => {
    expect(node.node_key).toBe('google_drive-list_folders-1');
    expect(node.implementation).toBe('execute');
    expect(node.execute).toBe(execute);
    expect(node.required_scopes).toEqual(['https://www.googleapis.com/auth/drive.readonly']);
  });

  it('takes the browse input and answers with the scope-option shape', () => {
    expect(Object.keys(definition.input_schema.properties)).toEqual([
      'parent_id',
      'query',
      'cursor',
      'limit',
    ]);
    expect(definition.output_schema.required).toEqual(['options', 'next_cursor']);
    expect(Object.keys(definition.output_schema.properties.options.items.properties)).toEqual([
      'id',
      'label',
      'sublabel',
      'preview',
      'kind',
      'has_children',
      'selectable',
    ]);
  });

  it('is the browse node the app sync declaration points at', () => {
    expect(app_definition.sync.dimensions[0]).toMatchObject({
      key: 'folders',
      shape: 'tree',
      browse_node: definition.node_key,
    });
  });
});

describe('google_drive-list_folders-1 execute', () => {
  it('maps a recorded page onto pickable options', async () => {
    stub_fetch_with(fixtures.list_folders_page_one);

    const output = await execute({ parent_id: '0AJfolder_root_workspace', limit: 2 }, context);

    expect(output).toEqual({
      options: [
        {
          id: '0AJfolder_people_ops',
          label: 'People Ops',
          kind: 'folder',
          has_children: true,
          selectable: true,
        },
        {
          id: '0AJfolder_finance',
          label: 'Finance',
          kind: 'folder',
          has_children: true,
          selectable: true,
        },
      ],
      next_cursor: '~!!~AI9FV7Rfb2xkZXJz',
    });
    expect(Object.keys(output)).toEqual(definition.output_schema.required);
  });

  it('asks Drive for folders under the named parent, in name order', async () => {
    stub_fetch_with(fixtures.list_folders_page_one);

    await execute({ parent_id: '0AJfolder_people_ops', limit: 25 }, context);

    const parameters = last_request_parameters();
    expect(requested_urls[0]).toContain('https://www.googleapis.com/drive/v3/files?');
    expect(parameters.get('q')).toBe(
      "trashed = false and mimeType = 'application/vnd.google-apps.folder' and " +
        "'0AJfolder_people_ops' in parents",
    );
    expect(parameters.get('fields')).toBe('nextPageToken, files(id, name)');
    expect(parameters.get('orderBy')).toBe('name');
    expect(parameters.get('supportsAllDrives')).toBe('true');
    expect(parameters.get('includeItemsFromAllDrives')).toBe('true');
    expect(parameters.get('pageSize')).toBe('25');
  });

  it('starts at My Drive root when no parent is named, and escapes a quoted name filter', async () => {
    stub_fetch_with(fixtures.list_folders_page_one);

    await execute({ query: "Ada's notes", cursor: 'page_two' }, context);

    const parameters = last_request_parameters();
    expect(parameters.get('q')).toBe(
      "trashed = false and mimeType = 'application/vnd.google-apps.folder' and " +
        "'root' in parents and name contains 'Ada\\'s notes'",
    );
    expect(parameters.get('pageToken')).toBe('page_two');
  });

  it('reports the end of the list as a null cursor', async () => {
    stub_fetch_with(fixtures.list_folders_last_page);

    const output = await execute({}, context);

    expect(output.next_cursor).toBeNull();
    expect(output.options).toHaveLength(1);
  });

  it('keeps the page when Drive returns a folder with no id', async () => {
    stub_fetch_with(fixtures.list_folders_sparse_page);

    const output = await execute({}, context);

    expect(output.options).toEqual([
      {
        id: '0AJfolder_legal',
        label: 'Legal',
        kind: 'folder',
        has_children: true,
        selectable: true,
      },
    ]);
  });

  it('raises a typed error when Drive rejects the query', async () => {
    stub_fetch_with(fixtures.list_folders_bad_query, 400);

    const failure = await execute({}, context).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConnectorHttpError);
    expect(failure).toMatchObject({ code: 'provider_error', retryable: false, status: 400 });
    expect(requested_urls).toHaveLength(1);
  });
});
