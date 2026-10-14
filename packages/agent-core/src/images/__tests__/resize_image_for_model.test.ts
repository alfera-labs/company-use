import {
  as_base64,
  generate_bitmap,
  generate_png,
} from '@agent-core/images/__tests__/image_fixtures';
import { resize_image_for_model } from '@agent-core/images/resize_image_for_model';
import { describe, expect, it } from 'vitest';

const provider_media_types = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

describe('resize_image_for_model', () => {
  it('shrinks an image that is barely over the limit instead of refusing it', async () => {
    const resized = await resize_image_for_model(as_base64(generate_png(2003, 1602)), 'image/png');

    expect(resized).toBeDefined();
    expect(resized?.dimension_note).toContain('2003x1602');
    expect(resized?.dimension_note).toContain('2000x');
  });

  it('leaves an image that already fits exactly as it was', async () => {
    expect(await resize_image_for_model(as_base64(generate_png(800, 600)), 'image/png')).toBe(
      undefined,
    );
  });

  it('re-encodes a heavy image whose dimensions are already legal', async () => {
    const heavy = generate_png(2000, 1125, true);
    const resized = await resize_image_for_model(as_base64(heavy), 'image/png');

    expect(resized?.mime_type).toBe('image/jpeg');
    expect(resized?.data.length).toBeLessThan(as_base64(heavy).length);
    expect(resized?.dimension_note).toContain('2000x1125');
  });

  it('leaves bytes it cannot decode alone', async () => {
    expect(await resize_image_for_model(as_base64(Buffer.from('not an image')), 'image/png')).toBe(
      undefined,
    );
  });

  it.each([
    'image/PNG',
    'image/png; charset=binary',
  ])('corrects the spelling of %s without touching the pixels', async (mime_type) => {
    const original = as_base64(generate_png(800, 600));
    const result = await resize_image_for_model(original, mime_type);

    expect(result?.mime_type).toBe('image/png');
    expect(result?.data).toBe(original);
  });

  it('never returns a media type the provider does not accept', async () => {
    const result = await resize_image_for_model(as_base64(generate_bitmap()), 'image/bmp');

    if (result) expect(provider_media_types).toContain(result.mime_type);
  });
});
