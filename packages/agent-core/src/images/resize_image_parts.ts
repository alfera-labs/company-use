import { resize_image_for_model } from '@agent-core/images/resize_image_for_model';
import type { RuntimeToolContentPart } from '@agent-core/tools/runtime_tool_result';

export async function resize_image_parts_for_model(
  parts: RuntimeToolContentPart[],
): Promise<RuntimeToolContentPart[]> {
  if (!parts.some((part) => part.type === 'image')) return parts;

  const resized: RuntimeToolContentPart[] = [];
  for (const part of parts) {
    if (part.type !== 'image') {
      resized.push(part);
      continue;
    }
    const image = await resize_image_for_model(part.data, part.mime_type);
    if (!image) {
      resized.push(part);
      continue;
    }
    if (image.dimension_note) resized.push({ type: 'text', text: image.dimension_note });
    resized.push({ type: 'image', data: image.data, mime_type: image.mime_type });
  }
  return resized;
}
