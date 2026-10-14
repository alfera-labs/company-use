import {
  create_email_attachment_sources,
  validate_email_attachment_url,
} from '@runtime-platform/channels/email/attachment_sources';
import type { ReceivedEmailAttachment } from '@runtime-platform/channels/email/resend_api';
import { afterEach, describe, expect, it, vi } from 'vitest';

const download_url = 'https://cdn.resend.app/4ef9a417/attachments/2a0c9ce0?signature=sig-123';

function attachment(overrides: Partial<ReceivedEmailAttachment> = {}): ReceivedEmailAttachment {
  return {
    id: '2a0c9ce0',
    filename: 'invoice.pdf',
    content_type: 'application/pdf',
    size: 11,
    download_url,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('create_email_attachment_sources', () => {
  it('describes each attachment before any bytes are fetched', async () => {
    const fetch_spy = vi.fn();
    vi.stubGlobal('fetch', fetch_spy);

    const sources = await create_email_attachment_sources('em_1', [attachment()]);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      attachment_id: 'email:em_1:2a0c9ce0',
      file_name: 'invoice.pdf',
      mime_type: 'application/pdf',
      byte_size: 11,
    });
    expect(fetch_spy).not.toHaveBeenCalled();
  });

  it('downloads the bytes when the run opens the attachment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['hello world']), { status: 200 })),
    );

    const [source] = await create_email_attachment_sources('em_1', [attachment()]);
    if (!source) throw new Error('expected one source');
    const stream = await source.open_bytes();
    const text = await new Response(stream).text();

    expect(text).toBe('hello world');
  });

  it('returns nothing when the email has no attachments', async () => {
    expect(await create_email_attachment_sources('em_1', [])).toEqual([]);
    expect(await create_email_attachment_sources('em_1', undefined)).toEqual([]);
  });

  it('falls back to a generated name and octet-stream when the provider omits them', async () => {
    const [source] = await create_email_attachment_sources('em_1', [
      attachment({ filename: null, content_type: null, size: null }),
    ]);

    expect(source?.file_name).toBe('attachment-2a0c9ce0');
    expect(source?.mime_type).toBe('application/octet-stream');
    expect(source?.byte_size).toBe(0);
  });

  it('rejects a download URL that is not a Resend host', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const [source] = await create_email_attachment_sources('em_1', [
      attachment({ download_url: 'https://evil.example.com/steal' }),
    ]);

    await expect(source?.open_bytes()).rejects.toThrowError(/Resend-owned HTTPS host/);
  });
});

describe('validate_email_attachment_url', () => {
  it.each([
    'https://cdn.resend.app/a/attachments/b',
    'https://inbound-cdn.resend.com/a/attachments/b',
    'https://resend.com/a',
  ])('accepts %s', (url) => {
    expect(validate_email_attachment_url(url).protocol).toBe('https:');
  });

  it.each([
    'http://inbound-cdn.resend.com/a',
    'https://resend.com.evil.example/a',
    'https://cdn.resend.app.evil.example/a',
    'https://example.com/a',
  ])('rejects %s', (url) => {
    expect(() => validate_email_attachment_url(url)).toThrowError();
  });
});
