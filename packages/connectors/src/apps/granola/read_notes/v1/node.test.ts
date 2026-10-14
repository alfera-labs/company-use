import app_definition from '@connectors/apps/granola/app.json' with { type: 'json' };
import { execute } from '@connectors/apps/granola/read_notes/v1/execute';
import fixtures from '@connectors/apps/granola/read_notes/v1/fixtures.json' with { type: 'json' };
import node_definition from '@connectors/apps/granola/read_notes/v1/node.json' with {
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
  log: create_logger('granola_read_notes_test'),
};

type StubbedNote = { status: number; body: unknown };

function stub_fetch_by_note_id(notes: Record<string, StubbedNote>) {
  const request_urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      request_urls.push(url);
      const note_id = new URL(url).pathname.split('/').pop() ?? '';
      const stubbed = notes[note_id];
      if (!stubbed) throw new Error(`Test asked for an unstubbed note: ${note_id}`);
      return new Response(JSON.stringify(stubbed.body), {
        status: stubbed.status,
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

describe('granola-read_notes-1 declaration', () => {
  it('names the key its own folder proves, and points at a real endpoint', () => {
    expect(node_definition.node_key).toBe('granola-read_notes-1');
    expect(node_definition.implementation).toBe('execute');
    expect(node_definition.provider.endpoint).toBe('GET /v1/notes/{note_id}');
    expect(node_definition.required_scopes).toEqual(['personal_notes', 'public_notes']);
  });

  it('takes an array of ids and answers with an array plus per-item errors', () => {
    expect(node_definition.input_schema.properties.note_ids).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 30,
    });
    expect(Object.keys(node_definition.output_schema.properties)).toEqual(['notes', 'errors']);
  });
});

describe('granola-read_notes-1', () => {
  it('reads a batch of notes with their summary, attendees, folders and calendar event', async () => {
    stub_fetch_by_note_id({
      not_00000000000001: { status: 200, body: fixtures.note_with_calendar_event },
      not_00000000000003: { status: 200, body: fixtures.note_without_calendar_event },
    });

    const output = await execute(
      { note_ids: ['not_00000000000001', 'not_00000000000003'] },
      context,
    );

    expect(output).toEqual({
      notes: [
        {
          id: 'not_00000000000001',
          title: 'Quarterly widget budget review',
          owner: { name: 'Pat Sample', email: 'pat@granola.ai' },
          created_at: '2026-01-27T15:30:00Z',
          updated_at: '2026-01-27T16:45:00Z',
          web_url: 'https://notes.granola.ai/d/f3e45e0f-24cc-480b-9a6c-8b1f5e3d7a2c',
          summary_text:
            'The quarterly widget budget review was a success. We spent $100,000 on widget and made $150,000 in profit.',
          summary_markdown:
            '## Quarterly Widget Budget Review\n\nThe quarterly widget budget review was a success.\n\n- Spent **$100,000** on widget\n- Made **$150,000** in profit',
          private_notes_text: 'Push back on the dairy forecast. Ask about the almond milk pivot.',
          private_notes_markdown:
            '- Push back on the dairy forecast\n- Ask about the **almond milk** pivot',
          attendees: [
            { name: 'Pat Sample', email: 'pat@granola.ai' },
            { name: 'Raisin Patel', email: 'raisin@granola.ai' },
          ],
          folders: [
            {
              id: 'fol_00000000000001',
              name: 'Top secret recipes',
              parent_folder_id: 'fol_00000000000002',
            },
          ],
          calendar_event: {
            event_title: 'Quarterly widget budget review',
            organiser_email: 'pat@granola.ai',
            calendar_event_id: '2su99n6iiik37iiknmb5t4fkfh_20260127T153000Z',
            scheduled_start_time: '2026-01-27T15:30:00Z',
            scheduled_end_time: '2026-01-27T16:30:00Z',
            invitee_emails: ['raisin@granola.ai', 'pat@granola.ai'],
          },
        },
        {
          id: 'not_00000000000003',
          title: 'Almond milk pivot',
          owner: { name: 'Raisin Patel', email: 'raisin@granola.ai' },
          created_at: '2026-01-20T11:00:00Z',
          updated_at: '2026-01-20T12:05:00Z',
          web_url: 'https://notes.granola.ai/d/6b1c2d90-7f43-4a55-9d18-2c7a0e5b4f31',
          summary_text: 'Raisin walked through the almond milk numbers alone.',
          summary_markdown: null,
          private_notes_text: null,
          private_notes_markdown: null,
          attendees: [],
          folders: [],
          calendar_event: null,
        },
      ],
      errors: [],
    });
  });

  it('returns exactly the note keys node.json promises', async () => {
    stub_fetch_by_note_id({
      not_00000000000001: { status: 200, body: fixtures.note_with_calendar_event },
    });

    const output = await execute({ note_ids: ['not_00000000000001'] }, context);

    expect(Object.keys(output).sort()).toEqual(
      Object.keys(node_definition.output_schema.properties).sort(),
    );
    expect(Object.keys(output.notes[0] ?? {}).sort()).toEqual(
      Object.keys(node_definition.output_schema.properties.notes.items.properties).sort(),
    );
  });

  it('reports the unreadable note and still returns the readable one', async () => {
    stub_fetch_by_note_id({
      not_00000000000001: { status: 200, body: fixtures.note_with_calendar_event },
      not_00000000000002: { status: 404, body: fixtures.note_not_found },
    });

    const output = await execute(
      { note_ids: ['not_00000000000001', 'not_00000000000002'] },
      context,
    );

    expect(output.notes.map((note) => note.id)).toEqual(['not_00000000000001']);
    expect(output.errors).toEqual([
      {
        note_id: 'not_00000000000002',
        code: 'provider_error',
        message: expect.stringContaining('404'),
        retryable: false,
      },
    ]);
  });

  it('never asks the provider for the inline transcript', async () => {
    const request_urls = stub_fetch_by_note_id({
      not_00000000000001: { status: 200, body: fixtures.note_with_calendar_event },
    });

    await execute({ note_ids: ['not_00000000000001'] }, context);

    expect(request_urls).toEqual(['https://public-api.granola.ai/v1/notes/not_00000000000001']);
  });
});
