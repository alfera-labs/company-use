import { read_outbound_email_attachments } from '@runtime-platform/channels/email/outbound_attachments';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { describe, expect, it, vi } from 'vitest';

function context(files: Record<string, Uint8Array>): RuntimeToolExecutionContext {
  return {
    environment: {
      read_bytes: async (path: string) => {
        const bytes = files[path];
        if (!bytes) throw new Error(`no such file: ${path}`);
        return bytes;
      },
    },
  } as unknown as RuntimeToolExecutionContext;
}

const pdf_bytes = new TextEncoder().encode('%PDF-1.4 report');

describe('read_outbound_email_attachments', () => {
  it('reads a workspace file into a base64 attachment with its mime type', async () => {
    const attachments = await read_outbound_email_attachments(
      context({ 'files/report.pdf': pdf_bytes }),
      ['files/report.pdf'],
    );

    expect(attachments).toEqual([
      {
        filename: 'report.pdf',
        content: Buffer.from(pdf_bytes).toString('base64'),
        content_type: 'application/pdf',
      },
    ]);
  });

  it('returns nothing when no paths are given', async () => {
    expect(await read_outbound_email_attachments(context({}), undefined)).toEqual([]);
    expect(await read_outbound_email_attachments(context({}), [])).toEqual([]);
  });

  it('reports the missing file instead of sending a silent empty attachment', async () => {
    await expect(
      read_outbound_email_attachments(context({}), ['files/nope.pdf']),
    ).rejects.toMatchObject({ code: 'file_read_failed' });
  });

  it('refuses when the workspace filesystem is unavailable', async () => {
    await expect(
      read_outbound_email_attachments({} as RuntimeToolExecutionContext, ['files/report.pdf']),
    ).rejects.toMatchObject({ code: 'workspace_unavailable' });
  });

  it('refuses a set of files over the 25 MB message budget', async () => {
    const big = new Uint8Array(13 * 1024 * 1024);
    await expect(
      read_outbound_email_attachments(context({ 'a.bin': big, 'b.bin': big }), ['a.bin', 'b.bin']),
    ).rejects.toMatchObject({ code: 'email_attachments_too_large' });
  });

  it('falls back to no content type for an unknown extension', async () => {
    const attachments = await read_outbound_email_attachments(
      context({ 'notes.xyz': new TextEncoder().encode('x') }),
      ['notes.xyz'],
    );

    expect(attachments[0]).toEqual({ filename: 'notes.xyz', content: 'eA==' });
  });
});

describe('outbound attachment wiring', () => {
  it('passes attachments through to the provider send payload', async () => {
    const { send_email_reply } = await import('@runtime-platform/channels/email/resend_api');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetch_spy = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'em_sent' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch_spy);

    await send_email_reply({
      from: 'acme@inbox.test',
      to: ['ada@example.com'],
      subject: 'Report',
      text: 'attached',
      attachments: [{ filename: 'report.pdf', content: 'YWJj', content_type: 'application/pdf' }],
    });

    const body = JSON.parse(String(fetch_spy.mock.calls[0]?.[1]?.body));
    expect(body.attachments).toEqual([
      { filename: 'report.pdf', content: 'YWJj', content_type: 'application/pdf' },
    ]);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
