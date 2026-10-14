import app_definition from '@connectors/apps/google_drive/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/google_drive/list_changes/v1/execute';
import fixtures from '@connectors/apps/google_drive/list_changes/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/google_drive/list_changes/v1/node.json' with {
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
  connection_id: 'conn_google_drive_changes',
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

describe('google_drive-list_changes-1 definition', () => {
  it('declares the key its own folder proves, and the code that runs it', () => {
    expect(definition.node_key).toBe('google_drive-list_changes-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual(['https://www.googleapis.com/auth/drive.readonly']);
  });

  it('names both endpoints and the condition that picks between them', () => {
    expect(definition.requests.changes_start_page_token.path).toBe('changes/startPageToken');
    expect(definition.requests.changes_list.path).toBe('changes');
    expect(definition.requests.changes_start_page_token.when).toBe('input.cursor is absent');
    expect(definition.output_schema.required).toEqual(['changes', 'next_cursor', 'has_more']);
  });
});

describe('google_drive-list_changes-1 execute', () => {
  it('hands back the current start cursor when the caller has none', async () => {
    stub_fetch_with(fixtures.start_page_token);

    const output = await execute({}, context);

    expect(output).toEqual({ changes: [], next_cursor: '918274', has_more: false });
    expect(Object.keys(output)).toEqual(definition.output_schema.required);
    expect(requested_urls[0]).toBe(
      'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true',
    );
  });

  it('maps a middle page and says there is more of this batch', async () => {
    stub_fetch_with(fixtures.changes_middle_page);

    const output = await execute({ cursor: '918274', limit: 100 }, context);

    expect(output).toEqual({
      changes: [
        {
          file_id: '1aBcD_handbook',
          change_type: 'file',
          time: '2026-09-01T08:31:12.004Z',
          removed: false,
          drive_id: null,
          file: {
            id: '1aBcD_handbook',
            name: 'Employee Handbook',
            mime_type: 'application/vnd.google-apps.document',
            modified_time: '2026-09-01T08:31:11.902Z',
            version: '421',
            web_view_link: 'https://docs.google.com/document/d/1aBcD_handbook/edit?usp=drivesdk',
            parent_ids: ['0AJfolder_people_ops'],
            trashed: false,
          },
        },
        {
          file_id: '1qRsT_old_invoice',
          change_type: 'file',
          time: '2026-09-01T09:02:44.771Z',
          removed: true,
          drive_id: null,
          file: null,
        },
      ],
      next_cursor: '918290',
      has_more: true,
    });

    const parameters = last_request_parameters();
    expect(parameters.get('pageToken')).toBe('918274');
    expect(parameters.get('pageSize')).toBe('100');
    expect(parameters.get('includeRemoved')).toBe('true');
    expect(parameters.get('includeItemsFromAllDrives')).toBe('true');
    expect(parameters.get('supportsAllDrives')).toBe('true');
    expect(parameters.get('fields')).toContain('newStartPageToken');
  });

  it('turns the last page newStartPageToken into the cursor for next time', async () => {
    stub_fetch_with(fixtures.changes_last_page);

    const output = await execute({ cursor: '918290' }, context);

    expect(output.next_cursor).toBe('918301');
    expect(output.has_more).toBe(false);
    expect(output.changes[0]).toMatchObject({
      drive_id: '0AJshared_drive_sales',
      file: { id: '1eFgH_pricing', trashed: true },
    });
  });

  it('raises a typed error for a cursor Drive no longer accepts', async () => {
    stub_fetch_with(fixtures.changes_expired_token, 400);

    const failure = await execute({ cursor: 'a token from last year' }, context).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ConnectorHttpError);
    expect(failure).toMatchObject({ code: 'provider_error', retryable: false, status: 400 });
    expect(requested_urls).toHaveLength(1);
  });
});
