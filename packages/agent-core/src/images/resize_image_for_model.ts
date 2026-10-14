import { Buffer } from 'node:buffer';
import { max_model_image_pixels } from '@agent-core/images/model_image_limit';
import { model_image_byte_budget } from '@coworker/shared';
import { convertToPng, formatDimensionNote, resizeImage } from '@earendil-works/pi-coding-agent';

// A per-image budget, and the number that decides the format.
//
// Pi offers the resizer PNG first and then JPEG, and takes the first encoding that fits this
// budget rather than the smallest one — its own comment says otherwise, the loop does not. So a
// generous budget hands back PNG for everything, and PNG on a photograph is several times the
// size of the JPEG that went in. That is how a session accumulates tens of megabytes of
// individually legal pages: lossless compression applied to photographs.
//
// One megabyte picks the right format on its own. A photograph's PNG does not fit, so JPEG wins;
// line art and screenshots, where PNG genuinely is smaller and sharper, fit and stay PNG. It also
// bounds the whole request rather than one image: twenty images is the most a request can hold
// before the stricter pixel rule applies, and twenty megabytes leaves room under the ceiling.
const max_model_image_base64_bytes = model_image_byte_budget;

export type ResizedModelImage = {
  data: string;
  mime_type: string;
  dimension_note: string | undefined;
};

// Anthropic accepts exactly these four, so anything else has to become one of them or it is
// rejected on arrival. The aliases are here because `image/jpg` and a mime with a charset suffix
// name a type the provider does accept — they only look unsupported until they are normalized.
const provider_image_media_types = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/gif', 'image/gif'],
  ['image/webp', 'image/webp'],
]);

export async function resize_image_for_model(
  data: string,
  mime_type: string,
): Promise<ResizedModelImage | undefined> {
  const supported = await convert_to_supported_media_type(data, mime_type);
  if (!supported) return undefined;

  const resized = await resizeImage(
    new Uint8Array(Buffer.from(supported.data, 'base64')),
    supported.mime_type,
    {
      maxWidth: max_model_image_pixels,
      maxHeight: max_model_image_pixels,
      maxBytes: max_model_image_base64_bytes,
    },
  ).catch(() => null);

  if (!resized?.wasResized) {
    return supported.mime_type === mime_type
      ? undefined
      : { ...supported, dimension_note: undefined };
  }

  return {
    data: resized.data,
    mime_type: resized.mimeType,
    dimension_note: formatDimensionNote(resized),
  };
}

async function convert_to_supported_media_type(data: string, mime_type: string) {
  const declared = mime_type.split(';')[0]?.trim().toLowerCase() ?? '';
  const supported = provider_image_media_types.get(declared);
  if (supported) return { data, mime_type: supported };

  const converted = await convertToPng(data, declared).catch(() => null);
  if (!converted) return undefined;
  return { data: converted.data, mime_type: converted.mimeType };
}
