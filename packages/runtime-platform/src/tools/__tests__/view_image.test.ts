import { deflateSync } from 'node:zlib';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { find_workspace_tool } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it, vi } from 'vitest';

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64');
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_BYTES = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const NOT_AN_IMAGE = Uint8Array.from(Buffer.from('<html>nope</html>', 'utf8'));

function generate_png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(typed.length + 8);
    out.writeUInt32BE(data.length, 0);
    typed.copy(out, 4);
    let crc = 0xffffffff;
    for (const byte of typed) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, typed.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const pixels = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row += 1) pixels[row * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function context(read_bytes?: (path: string) => Promise<Uint8Array | undefined>) {
  return { environment: read_bytes ? { read_bytes } : {} } as never;
}

async function run_view_image(
  path: string,
  read_bytes?: (path: string) => Promise<Uint8Array | undefined>,
): Promise<RuntimeToolResult> {
  const tool = find_workspace_tool('sandbox-view_image');
  if (!tool) throw new Error('sandbox-view_image is not registered');
  return tool.execute({ path }, context(read_bytes));
}

describe('sandbox-view_image', () => {
  it('is registered with its workspace alias', () => {
    expect(find_workspace_tool('sandbox-view_image')).toBeDefined();
    expect(find_workspace_tool('workspace-view_image')).toBeDefined();
  });

  it('returns an image content part for a PNG the sandbox can read', async () => {
    const read_bytes = vi.fn().mockResolvedValue(PNG_BYTES);
    const result = await run_view_image('tmp/slide-01.png', read_bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(read_bytes).toHaveBeenCalledWith('tmp/slide-01.png');
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('image/png') },
      { type: 'image', data: PNG_BASE64, mime_type: 'image/png' },
    ]);
    expect(result.content_text ?? '').not.toContain(PNG_BASE64);
  });

  it('derives the mime from the file signature, not the extension', async () => {
    for (const [path, bytes, mime] of [
      ['tmp/a.jpg', JPEG_BYTES, 'image/jpeg'],
      ['tmp/a.jpeg', JPEG_BYTES, 'image/jpeg'],
      ['tmp/a.gif', GIF_BYTES, 'image/gif'],
      ['tmp/a.webp', WEBP_BYTES, 'image/webp'],
      ['tmp/mislabeled.jpg', PNG_BYTES, 'image/png'],
    ] as const) {
      const result = await run_view_image(path, async () => bytes);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content?.[1]).toMatchObject({ type: 'image', mime_type: mime });
    }
  });

  it('rejects bytes that are not a real image even with an image extension', async () => {
    const result = await run_view_image('tmp/fake.png', async () => NOT_AN_IMAGE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('not_an_image');
  });

  it('rejects non-image extensions without touching the filesystem', async () => {
    const read_bytes = vi.fn();
    const result = await run_view_image('tmp/notes.txt', read_bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('unsupported_image_type');
    expect(read_bytes).not.toHaveBeenCalled();
  });

  it('errors when the image bytes cannot be read', async () => {
    const result = await run_view_image('tmp/missing.png', async () => undefined);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('image_unreadable');
  });

  it('errors on an empty file', async () => {
    const result = await run_view_image('tmp/empty.png', async () => new Uint8Array(0));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('image_unreadable');
  });

  it('errors when the sandbox cannot read binary (no read_bytes)', async () => {
    const result = await run_view_image('tmp/slide-01.png');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('image_unreadable');
  });

  it('refuses only images too large to read into memory', async () => {
    const oversized = new Uint8Array(25 * 1024 * 1024 + 1);
    const result = await run_view_image('tmp/huge.png', async () => oversized);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('image_too_large');
  });

  it('resizes an image over the per-side limit instead of refusing it', async () => {
    const result = await run_view_image('tmp/photo.png', async () =>
      Uint8Array.from(generate_png(2003, 1602)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const image = result.content?.find((part) => part.type === 'image');
    expect(image).toBeDefined();
    expect(result.content_text ?? '').toContain('2003x1602');
  }, 30_000);
});
