import { as_base64, generate_png } from '@agent-core/images/__tests__/image_fixtures';
import { resize_image_parts_for_model } from '@agent-core/images/resize_image_parts';
import type { RuntimeToolContentPart } from '@agent-core/tools/runtime_tool_result';
import { describe, expect, it } from 'vitest';

const image_part = (bytes: Buffer): RuntimeToolContentPart => ({
  type: 'image',
  data: as_base64(bytes),
  mime_type: 'image/png',
});

describe('resize_image_parts_for_model', () => {
  it('shrinks a picture a tool produced and says what size it is now', async () => {
    const parts = await resize_image_parts_for_model([
      { type: 'text', text: 'Read image file' },
      image_part(generate_png(3000, 1688)),
    ]);

    const image = parts.find((part) => part.type === 'image');
    expect(image).toBeDefined();
    const notes = parts.filter((part) => part.type === 'text').map((part) => part.text);
    expect(notes.join('\n')).toContain('3000x1688');
    expect(notes.join('\n')).toContain('2000x');
  });

  it('puts the note before the picture it describes', async () => {
    const parts = await resize_image_parts_for_model([image_part(generate_png(3000, 1688))]);

    expect(parts.map((part) => part.type)).toEqual(['text', 'image']);
  });

  it('leaves a result with no picture in it untouched', async () => {
    const parts: RuntimeToolContentPart[] = [{ type: 'text', text: 'line one' }];

    expect(await resize_image_parts_for_model(parts)).toBe(parts);
  });

  it('leaves a picture that already fits exactly as it was', async () => {
    const original = image_part(generate_png(800, 600));

    expect(await resize_image_parts_for_model([original])).toEqual([original]);
  });

  it('passes a picture it cannot decode through', async () => {
    const undecodable: RuntimeToolContentPart = {
      type: 'image',
      data: Buffer.from('not an image').toString('base64'),
      mime_type: 'image/png',
    };

    expect(await resize_image_parts_for_model([undecodable])).toEqual([undecodable]);
  });
});
