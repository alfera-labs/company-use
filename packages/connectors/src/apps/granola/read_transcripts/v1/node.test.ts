import app_definition from '@connectors/apps/granola/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/granola/read_transcripts/v1/execute';
import fixtures from '@connectors/apps/granola/read_transcripts/v1/fixtures.json' with {
  type: 'json',
};
import node_definition from '@connectors/apps/granola/read_transcripts/v1/node.json' with {
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

const app = load_connector_app('apps/granola/app.json', app_definition);
const connection: ConnectorConnection = {
  connection_id: 'conn_granola_fixture',
  access_token: 'grn_test_key',
};

const context: ConnectorNodeContext = {
  app,
  connection: { connection_id: connection.connection_id },
  send_request: (request) => send_connector_http_request({ app, connection, ...request }),
  send_request_for_response: (request) =>
    send_connector_http_response({ app, connection, ...request }),
  fan_out,
  log: create_logger('granola_read_transcripts_test'),
};

function stub_fetch_with_pages(pages: readonly unknown[]) {
  const request_urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const index = Math.min(request_urls.length, pages.length - 1);
      request_urls.push(url);
      return new Response(JSON.stringify(pages[index]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return request_urls;
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('granola-read_transcripts-1 declaration', () => {
  it('names the key its own folder proves, and points at a real endpoint', () => {
    expect(node_definition.node_key).toBe('granola-read_transcripts-1');
    expect(node_definition.implementation).toBe('execute');
    expect(node_definition.provider.endpoint).toBe('GET /v1/notes/{note_id}/transcript');
  });

  it('caps the provider page size at 100, where Granola caps it', () => {
    expect(node_definition.input_schema.properties.page_size).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
    });
    expect(node_definition.input_schema.properties.maximum_items_per_note.default).toBe(1000);
  });
});

describe('granola-read_transcripts-1', () => {
  it('drains every page of a note into one ordered transcript', async () => {
    const request_urls = stub_fetch_with_pages([fixtures.macos_page_one, fixtures.macos_last_page]);

    const output = await execute({ note_ids: ['not_00000000000001'], page_size: 2 }, context);

    expect(output).toEqual({
      transcripts: [
        {
          note_id: 'not_00000000000001',
          truncated: false,
          items: [
            {
              speaker: {
                source: 'microphone',
                attribution: 'me',
                diarization_label: null,
                name: null,
              },
              text: "Let's start with the numbers for this quarter.",
              start_time: '2026-01-27T15:30:00Z',
              end_time: '2026-01-27T15:30:06Z',
            },
            {
              speaker: {
                source: 'speaker',
                attribution: 'them',
                diarization_label: null,
                name: 'Raisin Patel',
              },
              text: 'Agreed. Revenue is up and the plan holds.',
              start_time: '2026-01-27T15:30:07Z',
              end_time: '2026-01-27T15:30:13Z',
            },
            {
              speaker: {
                source: 'microphone',
                attribution: 'me',
                diarization_label: null,
                name: null,
              },
              text: 'Then we move the whole budget to Greek and close the quarter.',
              start_time: '2026-01-27T15:30:14Z',
              end_time: '2026-01-27T15:30:20Z',
            },
          ],
        },
      ],
      errors: [],
    });

    expect(request_urls).toHaveLength(2);
    const first_page = new URL(request_urls[0] as string);
    expect(first_page.pathname).toBe('/v1/notes/not_00000000000001/transcript');
    expect(first_page.searchParams.get('page_size')).toBe('2');
    expect(first_page.searchParams.get('cursor')).toBeNull();
    expect(new URL(request_urls[1] as string).searchParams.get('cursor')).toBe(
      'eyJyb3dfb2Zmc2V0Ijo1MCwiaXRlbV9vZmZzZXQiOjB9',
    );
  });

  it('returns exactly the keys node.json promises', async () => {
    stub_fetch_with_pages([fixtures.macos_last_page]);

    const output = await execute({ note_ids: ['not_00000000000001'] }, context);

    expect(Object.keys(output).sort()).toEqual(
      Object.keys(node_definition.output_schema.properties).sort(),
    );
    expect(Object.keys(output.transcripts[0] ?? {}).sort()).toEqual(
      Object.keys(node_definition.output_schema.properties.transcripts.items.properties).sort(),
    );
  });

  it('stops at the ceiling and says so instead of paging forever', async () => {
    const request_urls = stub_fetch_with_pages([fixtures.macos_page_one]);

    const output = await execute(
      { note_ids: ['not_00000000000001'], maximum_items_per_note: 1 },
      context,
    );

    expect(output.transcripts[0]?.truncated).toBe(true);
    expect(output.transcripts[0]?.items).toHaveLength(2);
    expect(request_urls).toHaveLength(1);
  });

  it('reads the iOS speaker shape, where only a diarization label is known', async () => {
    stub_fetch_with_pages([fixtures.ios_page]);

    const output = await execute({ note_ids: ['not_00000000000003'] }, context);

    expect(output.transcripts[0]?.items[0]?.speaker).toEqual({
      source: 'microphone',
      attribution: null,
      diarization_label: 'Speaker A',
      name: null,
    });
  });

  it('reports the unreadable note without losing the readable one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const readable = url.includes('not_00000000000001');
        return new Response(
          JSON.stringify(readable ? fixtures.macos_last_page : { error: { code: 'NOT_FOUND' } }),
          { status: readable ? 200 : 404, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const output = await execute(
      { note_ids: ['not_00000000000001', 'not_00000000000002'] },
      context,
    );

    expect(output.transcripts.map((transcript) => transcript.note_id)).toEqual([
      'not_00000000000001',
    ]);
    expect(output.errors).toEqual([
      expect.objectContaining({ note_id: 'not_00000000000002', code: 'provider_error' }),
    ]);
  });
});
