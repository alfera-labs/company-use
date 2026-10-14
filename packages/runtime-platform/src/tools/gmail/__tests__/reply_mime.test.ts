import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { create_local_session_env } from '@agent-core/environment/local_session_env';
import { read_reply_attachments } from '@runtime-platform/tools/gmail/reply_attachments';
import {
  build_reply_mime,
  list_reply_recipients,
  type RepliedMessage,
  type ReplyMimeInput,
} from '@runtime-platform/tools/gmail/reply_mime';
import { describe, expect, it } from 'vitest';

const venue_subject = 'Your questions about our offer 🎉';

const replied_message: RepliedMessage = {
  message_id: '<couple-123@mail.example.com>',
  references: '<first@mail.example.com>',
  thread_id: 'thread_1',
  reply_to_header: '',
  from_header: '"Sam & Alex" <couple@example.com>',
};

function build(overrides: Partial<ReplyMimeInput> = {}) {
  return build_reply_mime({
    from: 'venue@example.com',
    to: ['couple@example.com'],
    cc: [],
    bcc: [],
    subject: venue_subject,
    body: 'Hi! Here is our brochure.',
    body_type: 'plaintext',
    replied_message,
    attachments: [],
    boundary: 'test_boundary',
    ...overrides,
  }).toString('ascii');
}

function read_header(mime: string, name: string) {
  const head = mime.split('\r\n\r\n')[0] ?? '';
  return head
    .split('\r\n')
    .find((line) => line.startsWith(`${name}: `))
    ?.slice(name.length + 2);
}

function decode_encoded_word(value: string | undefined) {
  const match = /^=\?UTF-8\?B\?(.+)\?=$/u.exec(value ?? '');
  return match?.[1] ? Buffer.from(match[1], 'base64').toString('utf8') : value;
}

async function workspace_with(files: Record<string, Uint8Array>) {
  const root = await mkdtemp(path.join(tmpdir(), 'gmail-reply-'));
  await Promise.all(
    Object.entries(files).map(async ([file_path, bytes]) => {
      await mkdir(path.dirname(path.join(root, file_path)), { recursive: true });
      await writeFile(path.join(root, file_path), bytes);
    }),
  );
  return create_local_session_env({ working_directory: root });
}

describe('build_reply_mime', () => {
  it('keeps the exact subject, emoji included, as an RFC 2047 encoded word', () => {
    const subject = read_header(build(), 'Subject');
    expect(subject).toMatch(/^=\?UTF-8\?B\?/u);
    expect(decode_encoded_word(subject)).toBe(venue_subject);
  });

  it('leaves a plain ASCII subject readable and never prefixes it with Re:', () => {
    expect(read_header(build({ subject: 'Your wedding at the farm' }), 'Subject')).toBe(
      'Your wedding at the farm',
    );
  });

  it('encodes a subject with a line break so it cannot inject a header', () => {
    const mime = build({ subject: 'Hi\r\nBcc: attacker@example.com' });
    expect(mime).not.toContain('Bcc: attacker@example.com');
    expect(decode_encoded_word(read_header(mime, 'Subject'))).toBe(
      'Hi\r\nBcc: attacker@example.com',
    );
  });

  it('points In-Reply-To at the replied message and appends it to References', () => {
    const mime = build();
    expect(read_header(mime, 'In-Reply-To')).toBe('<couple-123@mail.example.com>');
    expect(read_header(mime, 'References')).toBe(
      '<first@mail.example.com> <couple-123@mail.example.com>',
    );
  });

  it('writes From, To, Cc and Bcc, and base64-encodes the UTF-8 body', () => {
    const mime = build({
      cc: ['planner@example.com'],
      bcc: ['archive@example.com'],
      body: 'Thanks 🎉',
    });
    expect(read_header(mime, 'From')).toBe('venue@example.com');
    expect(read_header(mime, 'To')).toBe('couple@example.com');
    expect(read_header(mime, 'Cc')).toBe('planner@example.com');
    expect(read_header(mime, 'Bcc')).toBe('archive@example.com');
    expect(mime).toContain(Buffer.from('Thanks 🎉').toString('base64'));
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(build({ body_type: 'html' })).toContain('Content-Type: text/html; charset="UTF-8"');
  });

  it('adds each attachment as its own base64 part with its name and type', () => {
    const pdf = Buffer.from('%PDF-1.4 brochure');
    const mime = build({
      attachments: [{ file_name: 'Brochure 2026.pdf', mime_type: 'application/pdf', bytes: pdf }],
    });
    expect(mime).toContain('Content-Type: application/pdf; name="Brochure 2026.pdf"');
    expect(mime).toContain('Content-Disposition: attachment; filename="Brochure 2026.pdf"');
    expect(mime).toContain(pdf.toString('base64'));
    expect(mime.endsWith('--test_boundary--\r\n')).toBe(true);
  });
});

describe('list_reply_recipients', () => {
  it('answers Reply-To first, then From, and keeps an explicit to', () => {
    expect(list_reply_recipients([], replied_message)).toEqual(['couple@example.com']);
    expect(
      list_reply_recipients([], { ...replied_message, reply_to_header: 'Planner <p@example.com>' }),
    ).toEqual(['p@example.com']);
    expect(list_reply_recipients(['me@example.com'], replied_message)).toEqual(['me@example.com']);
  });

  it('refuses when the original names nobody to answer', () => {
    expect(() => list_reply_recipients([], { ...replied_message, from_header: '' })).toThrow(
      /Pass `to` explicitly/u,
    );
  });
});

describe('read_reply_attachments', () => {
  const pdf = Buffer.from('%PDF-1.4 real file');

  it('pairs display names with paths by position and falls back to the file name', async () => {
    const files = await read_reply_attachments(
      await workspace_with({ 'files/a.pdf': pdf, 'files/b.pdf': pdf }),
      { file_paths: ['files/a.pdf', 'files/b.pdf'], file_names: ['Brochure.pdf'] },
    );
    expect(files.map((file) => [file.file_name, file.mime_type])).toEqual([
      ['Brochure.pdf', 'application/pdf'],
      ['b.pdf', 'application/pdf'],
    ]);
  });

  it('refuses an HTML page saved under a .pdf name', async () => {
    const page = Buffer.from('\n  <!DOCTYPE html><html><title>Sign in</title>');
    await expect(
      read_reply_attachments(await workspace_with({ 'files/brochure.pdf': page }), {
        file_paths: ['files/brochure.pdf'],
        file_names: [],
      }),
    ).rejects.toMatchObject({ code: 'attachment_is_a_web_page' });
  });

  it('refuses more than 25 MB of files in total', async () => {
    const big = new Uint8Array(13 * 1024 * 1024);
    await expect(
      read_reply_attachments(await workspace_with({ 'a.pdf': big, 'b.pdf': big }), {
        file_paths: ['a.pdf', 'b.pdf'],
        file_names: [],
      }),
    ).rejects.toMatchObject({ code: 'attachments_too_large' });
  });
});
