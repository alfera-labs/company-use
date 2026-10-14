import { image_part_for_model } from '@agent-core/engines/pi/pi_image_content';
import { read_image_dimensions, sniff_image_mime_type } from '@agent-core/images/image_header';
import {
  describe_oversized_image,
  find_oversized_image_size,
  max_model_image_pixels,
} from '@agent-core/images/model_image_limit';
import { describe, expect, it } from 'vitest';

const images = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAADZSiLoAAAAEklEQVR4nGP8//8/AzbAhFV0KMoBAJT8Ao/nGpNIAAAAAElFTkSuQmCC',
  jpeg: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAADAAQBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APQ6KKKKKKKKKKKKKKK//9k=',
  gif: 'R0lGODdhBQAEAIAAAAAAAP///ywAAAAABQAEAAACBISPqQUAOw==',
  webp_lossy: 'UklGRkTmAABXRUJQVlA4IDjmAACQHASdASqjCK8CPjE=',
  webp_extended: 'UklGRpTJAABXRUJQVlA4WAoAAAAQAAAAzwcAbwMAQUw=',
  webp_lossless: 'UklGRhEAAABXRUJQVlA4TAUAAAAvBQABAAAAAAAA',
};

function bytes_of(name: keyof typeof images): Uint8Array {
  return new Uint8Array(Buffer.from(images[name], 'base64'));
}

describe('sniff_image_mime_type', () => {
  it('names each real format from its signature', () => {
    expect(sniff_image_mime_type(bytes_of('png'))).toBe('image/png');
    expect(sniff_image_mime_type(bytes_of('jpeg'))).toBe('image/jpeg');
    expect(sniff_image_mime_type(bytes_of('gif'))).toBe('image/gif');
    expect(sniff_image_mime_type(bytes_of('webp_lossy'))).toBe('image/webp');
    expect(sniff_image_mime_type(bytes_of('webp_extended'))).toBe('image/webp');
    expect(sniff_image_mime_type(bytes_of('webp_lossless'))).toBe('image/webp');
  });

  it('rejects bytes that are not an image', () => {
    expect(sniff_image_mime_type(new Uint8Array(Buffer.from('%PDF-1.7\n')))).toBeUndefined();
    expect(sniff_image_mime_type(new Uint8Array())).toBeUndefined();
  });
});

describe('read_image_dimensions', () => {
  it('reads the real size of each format', () => {
    expect(read_image_dimensions(bytes_of('png'))).toEqual({ width: 3, height: 2 });
    expect(read_image_dimensions(bytes_of('jpeg'))).toEqual({ width: 4, height: 3 });
    expect(read_image_dimensions(bytes_of('gif'))).toEqual({ width: 5, height: 4 });
  });

  it('reads each webp codec, which stores its size a different way', () => {
    expect(read_image_dimensions(bytes_of('webp_lossy'))).toEqual({ width: 2211, height: 687 });
    expect(read_image_dimensions(bytes_of('webp_extended'))).toEqual({ width: 2000, height: 880 });
    expect(read_image_dimensions(bytes_of('webp_lossless'))).toEqual({ width: 6, height: 5 });
  });

  it('returns undefined instead of guessing when the header is truncated', () => {
    expect(read_image_dimensions(bytes_of('png').slice(0, 20))).toBeUndefined();
    expect(read_image_dimensions(bytes_of('jpeg').slice(0, 12))).toBeUndefined();
  });
});

describe('find_oversized_image_size', () => {
  it('reports the size of an image over the limit on one side only', () => {
    expect(find_oversized_image_size(png_header(1200, 6600))).toEqual({
      width: 1200,
      height: 6600,
    });
    expect(find_oversized_image_size(png_header(6600, 1200))).toEqual({
      width: 6600,
      height: 1200,
    });
    expect(find_oversized_image_size(bytes_of('webp_lossy'))).toEqual({
      width: 2211,
      height: 687,
    });
  });

  it('passes an image at the limit and below', () => {
    expect(find_oversized_image_size(png_header(2000, 2000))).toBeUndefined();
    expect(find_oversized_image_size(bytes_of('png'))).toBeUndefined();
    expect(find_oversized_image_size(bytes_of('webp_extended'))).toBeUndefined();
  });

  it('shows an image whose size cannot be read, rather than blocking it', () => {
    expect(find_oversized_image_size(new Uint8Array(Buffer.from('not an image')))).toBeUndefined();
  });
});

describe('describe_oversized_image', () => {
  it('states the subject, its size, and the limit, and prescribes no remedy', () => {
    const message = describe_oversized_image('/work/page-1.png', { width: 5100, height: 6600 });
    expect(message).toContain('/work/page-1.png');
    expect(message).toContain('5100x6600');
    expect(message).toContain(String(max_model_image_pixels));
    expect(message).not.toMatch(/pdftoppm|PIL|screenshot/);
  });
});

describe('image_part_for_model', () => {
  const base64_of = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

  it('sends an image within the limit unchanged', () => {
    const data = base64_of(bytes_of('png'));
    expect(image_part_for_model(data, 'image/png')).toEqual({
      type: 'image',
      data,
      mimeType: 'image/png',
    });
  });

  it('replaces an oversized image so a poisoned conversation keeps working', () => {
    const part = image_part_for_model(base64_of(png_header(5100, 6600)), 'image/png');
    expect(part.type).toBe('text');
    expect(part).not.toHaveProperty('data');
    if (part.type === 'text') expect(part.text).toContain('5100x6600');
  });

  it('sends an image it cannot measure, rather than dropping it', () => {
    const unmeasurable = base64_of(bytes_of('png')).slice(0, 8);
    expect(image_part_for_model(unmeasurable, 'image/png').type).toBe('image');
  });
});

function png_header(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
}
