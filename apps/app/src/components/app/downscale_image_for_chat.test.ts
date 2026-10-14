import { model_image_longest_side_px } from '@coworker/shared';
import { describe, expect, it } from 'vitest';
import {
  image_fits_inline,
  inline_image_byte_limit,
  scaled_image_dimensions,
} from '@/components/app/downscale_image_for_chat';

describe('scaled_image_dimensions', () => {
  it('leaves an image at or under the longest side untouched', () => {
    expect(scaled_image_dimensions(model_image_longest_side_px, 1024)).toEqual({
      width: model_image_longest_side_px,
      height: 1024,
    });
    expect(scaled_image_dimensions(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('scales the longest side down to the shared cap and keeps the aspect ratio', () => {
    expect(scaled_image_dimensions(4000, 2000)).toEqual({ width: 2000, height: 1000 });
    expect(scaled_image_dimensions(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });

  it('never rounds a side to zero', () => {
    expect(scaled_image_dimensions(100_000, 1).height).toBe(1);
  });
});

describe('image_fits_inline', () => {
  it('inlines only under the limit that keeps the request below the proxy body cap', () => {
    expect(image_fits_inline(inline_image_byte_limit)).toBe(true);
    expect(image_fits_inline(inline_image_byte_limit + 1)).toBe(false);
  });
});
