// @vitest-environment happy-dom
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DetachedWindowAPI } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upload_attachment_to_storage } from '@/lib/api/upload_attachment';

type RecordedPut = {
  url: string;
  method: string;
  content_type: string | undefined;
  byte_size: number;
};

let storage: Server;
let storage_origin: string;
let recorded_puts: RecordedPut[];
let ticket_requests: number;
let storage_status: number;
let storage_drops_connection: boolean;
let storage_entity_tag: string | undefined;
let minted_upload_url: string;

beforeEach(async () => {
  recorded_puts = [];
  ticket_requests = 0;
  storage_status = 200;
  storage_drops_connection = false;
  storage_entity_tag = undefined;
  storage = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response
        .writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'PUT, GET, HEAD',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        .end();
      return;
    }
    let byte_size = 0;
    request.on('data', (chunk: Buffer) => {
      byte_size += chunk.byteLength;
    });
    request.on('end', () => {
      if (storage_drops_connection) {
        request.socket.destroy();
        return;
      }
      recorded_puts.push({
        url: request.url ?? '',
        method: request.method ?? '',
        content_type: request.headers['content-type'],
        byte_size,
      });
      response
        .writeHead(storage_status, {
          'Access-Control-Allow-Origin': '*',
          ...(storage_entity_tag ? { etag: storage_entity_tag } : {}),
        })
        .end();
    });
  });
  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', resolve));
  storage_origin = `http://127.0.0.1:${(storage.address() as AddressInfo).port}`;
  minted_upload_url = `${storage_origin}/workspace/ws_1/files/art_from_server/deck.pdf`;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.includes('/v1/files/uploads')) throw new Error(`Unexpected fetch to ${url}`);
      ticket_requests += 1;
      return new Response(
        JSON.stringify({
          data: {
            file_id: 'art_from_server',
            upload_url: minted_upload_url,
            upload_method: 'PUT',
            upload_headers: { 'Content-Type': 'application/pdf' },
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => storage.close(() => resolve()));
});

describe('upload_attachment_to_storage', () => {
  it('sends the bytes to the signed URL and only a ticket request to our API', async () => {
    const file = new File([new Uint8Array(8)], 'deck.pdf', { type: 'application/pdf' });

    const upload = upload_attachment_to_storage(file, {}).catch(() => undefined);
    await vi.waitFor(() => expect(recorded_puts).toHaveLength(1), { timeout: 5_000 });

    expect(ticket_requests).toBe(1);
    expect(recorded_puts[0]).toEqual({
      url: '/workspace/ws_1/files/art_from_server/deck.pdf',
      method: 'PUT',
      content_type: 'application/pdf',
      byte_size: 8,
    });
    // Deliberately not awaited: in this DOM the upload never resolves. The floating promise
    // is swallowed by the .catch above so it cannot fail the run.
    void upload;
  });

  it('sends the bytes to a link on its own origin and finishes when storage answers with an ETag', async () => {
    const page: DetachedWindowAPI = Reflect.get(window, 'happyDOM');
    page.setURL(`${storage_origin}/chat/ses_1`);
    minted_upload_url = '/api/v1/local_file_objects?ticket=signed.ticket';
    storage_entity_tag = '"8-19c0a1b2c3d"';
    const file = new File([new Uint8Array(8)], 'deck.pdf', { type: 'application/pdf' });

    const uploaded = await upload_attachment_to_storage(file, {});

    expect(uploaded).toEqual({
      file_id: 'art_from_server',
      file_name: 'deck.pdf',
      mime_type: 'application/pdf',
      byte_size: 8,
    });
    expect(recorded_puts).toEqual([
      {
        url: '/api/v1/local_file_objects?ticket=signed.ticket',
        method: 'PUT',
        content_type: 'application/pdf',
        byte_size: 8,
      },
    ]);
  });

  it('says a blocked upload looks like a missing CORS rule', async () => {
    storage_drops_connection = true;
    const file = new File([new Uint8Array(4)], 'deck.pdf', { type: 'application/pdf' });

    await expect(upload_attachment_to_storage(file, {})).rejects.toThrow(/CORS/u);
  });

  it('reports a rejection that storage actually answered', async () => {
    storage_status = 403;
    const file = new File([new Uint8Array(4)], 'deck.pdf', { type: 'application/pdf' });

    await expect(upload_attachment_to_storage(file, {})).rejects.toThrow(/Non 2xx|403/u);
  });
});
