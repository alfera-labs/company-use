import app_definition from '@connectors/apps/google_drive/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/google_drive/export_files/v1/execute';
import fixtures from '@connectors/apps/google_drive/export_files/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/google_drive/export_files/v1/node.json' with {
  type: 'json',
};
import { load_connector_app } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorConnection, ConnectorNodeContext } from '@connectors/types';
import { create_logger } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = load_connector_app('apps/google_drive/app.json', app_definition);

const connection: ConnectorConnection = {
  connection_id: 'conn_google_drive_export',
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

type StubbedResponse = { body: string; status?: number };

function stub_fetch_per_file(answers: Record<string, StubbedResponse>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested_urls.push(url);
      const file_id = /files\/([^/]+)\/export/u.exec(url)?.[1] ?? '';
      const answer = answers[decodeURIComponent(file_id)];
      if (!answer) throw new Error(`No stubbed answer for ${url}`);
      return new Response(answer.body, {
        status: answer.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  reset_rate_limit_buckets();
  requested_urls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('google_drive-export_files-1 definition', () => {
  it('declares the key its own folder proves, and the code that runs it', () => {
    expect(definition.node_key).toBe('google_drive-export_files-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual(['https://www.googleapis.com/auth/drive.readonly']);
  });

  it('takes a bounded array of files and answers per file, never all or nothing', () => {
    const files_input = definition.input_schema.properties.files;
    expect(files_input.type).toBe('array');
    expect(files_input.minItems).toBe(1);
    expect(files_input.maxItems).toBe(100);
    expect(files_input.items.required).toEqual(['file_id', 'mime_type']);
    const item_shapes = definition.output_schema.properties.files.items.oneOf;
    expect(item_shapes).toHaveLength(2);
    expect(item_shapes[0]?.required).toEqual(['ok', 'file_id', 'mime_type', 'text']);
    expect(item_shapes[1]?.required).toEqual(['ok', 'file_id', 'error']);
  });
});

describe('google_drive-export_files-1 execute', () => {
  it('exports every file in the caller order and asks for the right mime type', async () => {
    stub_fetch_per_file({
      '1aBcD_handbook': { body: fixtures.handbook_markdown_export },
      '1eFgH_pricing': { body: fixtures.pricing_csv_export },
      '1iJkL_offsite_deck': { body: fixtures.offsite_deck_text_export },
    });

    const output = await execute(
      {
        files: [
          { file_id: '1aBcD_handbook', mime_type: 'text/markdown' },
          { file_id: '1eFgH_pricing', mime_type: 'text/csv' },
          { file_id: '1iJkL_offsite_deck', mime_type: 'text/plain' },
        ],
      },
      context,
    );

    expect(output).toEqual({
      files: [
        {
          ok: true,
          file_id: '1aBcD_handbook',
          mime_type: 'text/markdown',
          text: fixtures.handbook_markdown_export,
        },
        {
          ok: true,
          file_id: '1eFgH_pricing',
          mime_type: 'text/csv',
          text: fixtures.pricing_csv_export,
        },
        {
          ok: true,
          file_id: '1iJkL_offsite_deck',
          mime_type: 'text/plain',
          text: fixtures.offsite_deck_text_export,
        },
      ],
    });
    expect(Object.keys(output)).toEqual(definition.output_schema.required);
    expect(requested_urls).toHaveLength(3);
    expect(requested_urls[0]).toBe(
      'https://www.googleapis.com/drive/v3/files/1aBcD_handbook/export?mimeType=text%2Fmarkdown',
    );
  });

  it('keeps the exports that worked when one file fails', async () => {
    stub_fetch_per_file({
      '1aBcD_handbook': { body: fixtures.handbook_markdown_export },
      '1zZzZ_missing': { body: JSON.stringify(fixtures.export_file_not_found), status: 404 },
      '1mNoP_scan': { body: JSON.stringify(fixtures.export_not_a_native_file), status: 403 },
    });

    const output = await execute(
      {
        files: [
          { file_id: '1aBcD_handbook', mime_type: 'text/markdown' },
          { file_id: '1zZzZ_missing', mime_type: 'text/plain' },
          { file_id: '1mNoP_scan', mime_type: 'text/plain' },
        ],
      },
      context,
    );

    expect(output.files[0]).toMatchObject({ ok: true, file_id: '1aBcD_handbook' });
    expect(output.files[1]).toMatchObject({
      ok: false,
      file_id: '1zZzZ_missing',
      error: { code: 'provider_error', retryable: false },
    });
    expect(output.files[2]).toMatchObject({ ok: false, file_id: '1mNoP_scan' });
  });
});
