// An image part rides the message request as base64 through the Vercel proxy, whose request
// body cap is 4.5 MB — a 3.6 MB photo encodes past it and the whole send fails with a 413.
// The size and byte numbers come from the shared model-image policy, so this downscale and
// the server-side resizer (agent-core resize_image_for_model) cannot drift apart and shrink
// the same image twice.
import { model_image_byte_budget, model_image_longest_side_px } from '@coworker/shared';

export const inline_image_byte_limit = model_image_byte_budget;

const jpeg_quality = 0.85;

export function image_fits_inline(byte_size: number) {
  return byte_size <= inline_image_byte_limit;
}

export function scaled_image_dimensions(
  width: number,
  height: number,
  longest_side = model_image_longest_side_px,
) {
  if (width <= longest_side && height <= longest_side) return { width, height };
  const scale = longest_side / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function downscale_image_for_chat(
  file: File,
): Promise<{ data_url: string; mime_type: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaled_image_dimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable for image downscaling');
    context.drawImage(bitmap, 0, 0, width, height);
    return { data_url: canvas.toDataURL('image/jpeg', jpeg_quality), mime_type: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

const image_types_every_browser_opens = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * Refuses an image file the browser cannot open. Only the types every browser opens are judged:
 * a broken one would show as a broken picture in the chat, and the model would refuse the run.
 */
export async function refuse_image_that_cannot_be_opened(file: File, mime_type: string) {
  if (!image_types_every_browser_opens.has(mime_type)) return;
  if (typeof createImageBitmap !== 'function') return;
  try {
    (await createImageBitmap(file)).close();
  } catch {
    throw new Error(`${file.name} is not an image that can be opened. Choose another file.`);
  }
}
