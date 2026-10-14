import {
  create_local_file_url,
  local_file_objects_dashboard_path,
  verify_local_file_ticket,
} from '@runtime-platform/files/local_file_ticket';
import { describe, expect, it } from 'vitest';

const issued_at = new Date('2026-01-01T00:00:00.000Z');
const upload = {
  operation: 'put',
  bucket_folder: 'ARTIFACT_UPLOAD_BUCKET',
  object_key: 'workspace/ws_1/files/art_1/deck.pdf',
  content_type: 'application/pdf',
  byte_size: 1_024,
  expires_in_seconds: 600,
} as const;

function ticket_of(url: string) {
  const ticket = new URL(url, 'http://dashboard.test').searchParams.get('ticket');
  if (!ticket) throw new Error('the link carries no ticket');
  return ticket;
}

function with_changed_claim(ticket: string, change: Record<string, unknown>) {
  const [body = '', signature = ''] = ticket.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const changed = Buffer.from(JSON.stringify({ ...claims, ...change })).toString('base64url');
  return `${changed}.${signature}`;
}

function seconds_later(seconds: number) {
  return new Date(issued_at.getTime() + seconds * 1000);
}

describe('local file ticket', () => {
  it('hands out a same-origin dashboard link that verifies to the signed claims', () => {
    const url = create_local_file_url(upload, issued_at);

    expect(url.startsWith(`${local_file_objects_dashboard_path}?ticket=`)).toBe(true);
    expect(verify_local_file_ticket(ticket_of(url), 'put', seconds_later(599))).toEqual({
      v: 1,
      operation: 'put',
      bucket_folder: 'ARTIFACT_UPLOAD_BUCKET',
      object_key: 'workspace/ws_1/files/art_1/deck.pdf',
      content_type: 'application/pdf',
      byte_size: 1_024,
      exp: issued_at.getTime() / 1000 + 600,
    });
  });

  it('refuses an expired ticket', () => {
    const ticket = ticket_of(create_local_file_url(upload, issued_at));

    expect(() => verify_local_file_ticket(ticket, 'put', seconds_later(600))).toThrow(/expired/);
  });

  it.each<[string, Record<string, unknown>]>([
    ['object key', { object_key: 'workspace/ws_2/files/art_9/theirs.pdf' }],
    ['byte size', { byte_size: 999_999_999 }],
    ['content type', { content_type: 'text/html' }],
    ['bucket folder', { bucket_folder: 'MEMORY_IMPORT_BUCKET' }],
    ['expiry', { exp: issued_at.getTime() / 1000 + 86_400 }],
    ['operation', { operation: 'get', file_name: 'deck.pdf', byte_size: undefined }],
  ])('refuses a ticket with a changed %s', (_claim, change) => {
    const ticket = ticket_of(create_local_file_url(upload, issued_at));
    const operation = change.operation === 'get' ? 'get' : 'put';

    expect(() =>
      verify_local_file_ticket(with_changed_claim(ticket, change), operation, issued_at),
    ).toThrow(/not valid/);
  });

  it('refuses a changed signature and a ticket that is not one', () => {
    const ticket = ticket_of(create_local_file_url(upload, issued_at));
    const flipped = ticket.endsWith('A') ? `${ticket.slice(0, -1)}B` : `${ticket.slice(0, -1)}A`;

    expect(() => verify_local_file_ticket(flipped, 'put', issued_at)).toThrow(/not valid/);
    expect(() => verify_local_file_ticket('', 'put', issued_at)).toThrow(/not valid/);
    expect(() => verify_local_file_ticket('a.b.c', 'put', issued_at)).toThrow(/not valid/);
  });

  it('never lets an upload ticket download, or a download ticket upload', () => {
    const upload_ticket = ticket_of(create_local_file_url(upload, issued_at));
    const download_ticket = ticket_of(
      create_local_file_url(
        {
          operation: 'get',
          bucket_folder: 'ARTIFACT_UPLOAD_BUCKET',
          object_key: upload.object_key,
          content_type: 'application/pdf',
          file_name: 'deck.pdf',
          expires_in_seconds: 300,
        },
        issued_at,
      ),
    );

    expect(() => verify_local_file_ticket(upload_ticket, 'get', issued_at)).toThrow(/not valid/);
    expect(() => verify_local_file_ticket(download_ticket, 'put', issued_at)).toThrow(/not valid/);
    expect(verify_local_file_ticket(download_ticket, 'get', issued_at).file_name).toBe('deck.pdf');
  });

  it('answers a refused ticket with 403', () => {
    expect(() => verify_local_file_ticket('nope', 'put')).toThrow(
      expect.objectContaining({ status: 403, code: 'local_file_ticket_refused' }),
    );
  });
});
