import app_definition from '@connectors/apps/google_drive/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/google_drive/list_files/v1/execute';
import fixtures from '@connectors/apps/google_drive/list_files/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/google_drive/list_files/v1/node.json' with {
  type: 'json',
};
import { load_connector_app } from '@connectors/load_definition';
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

const connection: ConnectorConnection = {
  connection_id: 'conn_google_drive_files',
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

describe('google_drive-list_files-1 definition', () => {
  it('declares the key its own folder proves, and the code that runs it', () => {
    expect(definition.node_key).toBe('google_drive-list_files-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.description.trim().length).toBeGreaterThan(0);
    expect(definition.required_scopes).toEqual(['https://www.googleapis.com/auth/drive.readonly']);
  });

  it('takes filters as arrays and answers with an array and a cursor', () => {
    const input_properties = Object.keys(definition.input_schema.properties);
    expect(input_properties).toEqual(['query', 'folder_ids', 'mime_types', 'cursor', 'limit']);
    expect(definition.input_schema.properties.folder_ids.type).toBe('array');
    expect(definition.input_schema.properties.mime_types.type).toBe('array');
    expect(definition.output_schema.required).toEqual(['files', 'next_cursor']);
  });
});

describe('google_drive-list_files-1 execute', () => {
  it('maps a recorded page onto the node output', async () => {
    stub_fetch_with(fixtures.list_files_page_one);

    const output = await execute({ folder_ids: ['0AJfolder_people_ops'], limit: 2 }, context);

    expect(output).toEqual({
      files: [
        {
          id: '1aBcD_handbook',
          name: 'Employee Handbook',
          mime_type: 'application/vnd.google-apps.document',
          modified_time: '2026-08-30T09:14:22.481Z',
          version: '418',
          web_view_link: 'https://docs.google.com/document/d/1aBcD_handbook/edit?usp=drivesdk',
          parent_ids: ['0AJfolder_people_ops'],
        },
        {
          id: '1eFgH_pricing',
          name: 'Pricing 2026.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          modified_time: '2026-08-28T17:02:00.000Z',
          version: '12',
          web_view_link: 'https://docs.google.com/spreadsheets/d/1eFgH_pricing/edit?usp=drivesdk',
          parent_ids: ['0AJfolder_finance', '0AJfolder_shared_with_sales'],
        },
      ],
      next_cursor: '~!!~AI9FV7QmZ0dHJhY2tlcg==',
    });
    expect(Object.keys(output)).toEqual(definition.output_schema.required);
  });

  it('asks Drive for shared drives, the fields it maps, and the caller page size', async () => {
    stub_fetch_with(fixtures.list_files_page_one);

    await execute({ limit: 25 }, context);

    const parameters = last_request_parameters();
    expect(requested_urls[0]).toContain('https://www.googleapis.com/drive/v3/files?');
    expect(parameters.get('supportsAllDrives')).toBe('true');
    expect(parameters.get('includeItemsFromAllDrives')).toBe('true');
    expect(parameters.get('orderBy')).toBe('modifiedTime desc');
    expect(parameters.get('pageSize')).toBe('25');
    expect(parameters.get('fields')).toBe(
      'nextPageToken, files(id, name, mimeType, modifiedTime, version, webViewLink, parents)',
    );
  });

  it('builds one q string from all three filters and escapes the quote in a phrase', async () => {
    stub_fetch_with(fixtures.list_files_page_one);

    await execute(
      {
        query: "Ada's notes",
        folder_ids: ['0AJfolder_people_ops', '0AJfolder_finance'],
        mime_types: ['application/vnd.google-apps.document'],
        cursor: 'page_two',
      },
      context,
    );

    const parameters = last_request_parameters();
    expect(parameters.get('q')).toBe(
      "trashed = false and fullText contains 'Ada\\'s notes' and " +
        "('0AJfolder_people_ops' in parents or '0AJfolder_finance' in parents) and " +
        "(mimeType = 'application/vnd.google-apps.document')",
    );
    expect(parameters.get('pageToken')).toBe('page_two');
  });

  it('reports the end of the list as a null cursor', async () => {
    stub_fetch_with(fixtures.list_files_last_page);

    const output = await execute({}, context);

    expect(output.next_cursor).toBeNull();
  });

  it('keeps the page when Drive returns a file with no id', async () => {
    stub_fetch_with(fixtures.list_files_sparse_page);

    const output = await execute({}, context);

    expect(output).toEqual({
      files: [
        {
          id: '1mNoP_scan',
          name: 'Scanned Contract.pdf',
          mime_type: 'application/pdf',
          modified_time: null,
          version: null,
          web_view_link: null,
          parent_ids: [],
        },
      ],
      next_cursor: null,
    });
  });

  it('raises a typed error when Drive rejects the query', async () => {
    stub_fetch_with(fixtures.list_files_bad_query, 400);

    const failure = await execute({}, context).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConnectorHttpError);
    expect(failure).toMatchObject({ code: 'provider_error', retryable: false, status: 400 });
    expect(requested_urls).toHaveLength(1);
  });
});
