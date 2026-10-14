import {
  describe_oversized_image,
  find_oversized_image_size,
  read_image_header_from_base64,
} from '@agent-core/images/model_image_limit';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';

export function image_part_for_model(data: string, mime_type: string): ImageContent | TextContent {
  const oversize = find_oversized_image_size(read_image_header_from_base64(data));
  if (!oversize) return { type: 'image', data, mimeType: mime_type };

  return {
    type: 'text',
    text: `[${describe_oversized_image('An image in this conversation', oversize)} It is not shown.]`,
  };
}
