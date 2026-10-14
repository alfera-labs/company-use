// Whether an image is small enough to send to a model, and how to say that it wasn't.
//
// The limit is per side, and a request carrying several images is rejected whole when any one
// of them is over it — so an oversized image does not fail its own tool call, it fails the run.
// Every caller asks that question here, so none of them re-derives the comparison and they all
// move together when the limit does.

import { Buffer } from 'node:buffer';
import { type ImageDimensions, read_image_dimensions } from '@agent-core/images/image_header';
import { model_image_longest_side_px } from '@coworker/shared';

export const max_model_image_pixels = model_image_longest_side_px;

export function find_oversized_image_size(bytes: Uint8Array): ImageDimensions | undefined {
  const size = read_image_dimensions(bytes);
  if (!size) return undefined;
  if (size.width <= max_model_image_pixels && size.height <= max_model_image_pixels) {
    return undefined;
  }
  return size;
}

export function read_image_header_from_base64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data.slice(0, 64 * 1024), 'base64'));
}

export function describe_oversized_image(description: string, size: ImageDimensions): string {
  return (
    `${description} is ${size.width}x${size.height} pixels, over the ${max_model_image_pixels}px ` +
    `per-side limit for images sent to the model.`
  );
}
