import { Buffer } from 'node:buffer';
import type {
  RuntimeAgentMessagePart,
  RuntimeImageMessagePart,
} from '@agent-core/messages/runtime_message';
import {
  type RuntimeAttachmentSource,
  runtime_attachment_limits,
} from '@runtime-platform/attachments/runtime_attachment_source';
import { generate_safe_file_name } from '@runtime-platform/files/safe_file_name';

export type ImageAttachmentSources = {
  sources: RuntimeAttachmentSource[];
  notes: RuntimeAgentMessagePart[];
};

function image_attachment_id(run_id: string, part_index: number) {
  return `inline-image-${run_id}-${part_index + 1}`;
}

export function create_image_attachment_sources(
  run_id: string,
  parts: readonly RuntimeAgentMessagePart[],
  existing_sources: readonly RuntimeAttachmentSource[],
): ImageAttachmentSources {
  let remaining_slots = runtime_attachment_limits.max_attachments - existing_sources.length;
  let remaining_bytes =
    runtime_attachment_limits.max_request_bytes -
    existing_sources.reduce((total, source) => total + source.byte_size, 0);
  const sources: RuntimeAttachmentSource[] = [];
  const skipped_names: string[] = [];

  parts.forEach((part, index) => {
    if (part.type !== 'image') return;
    const file_name = generate_image_file_name(part, index);
    const bytes = new Uint8Array(Buffer.from(part.data, 'base64'));
    const byte_budget = Math.min(remaining_bytes, runtime_attachment_limits.max_attachment_bytes);
    if (remaining_slots < 1 || bytes.byteLength > byte_budget) {
      skipped_names.push(file_name);
      return;
    }
    remaining_slots -= 1;
    remaining_bytes -= bytes.byteLength;
    sources.push({
      attachment_id: image_attachment_id(run_id, index),
      file_name,
      mime_type: part.mime_type,
      byte_size: bytes.byteLength,
      open_bytes: async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    });
  });

  return { sources, notes: describe_skipped_images(skipped_names) };
}

function describe_skipped_images(skipped_names: readonly string[]): RuntimeAgentMessagePart[] {
  if (skipped_names.length === 0) return [];
  return [
    {
      type: 'text',
      text: `[note] This message is at its attachment limit, so these images were not saved to the workspace and have no file path: ${skipped_names.join(', ')}. You can still see them above.`,
    },
  ];
}

function generate_image_file_name(part: RuntimeImageMessagePart, index: number) {
  const subtype = part.mime_type
    .split(';')[0]
    ?.split('/')[1]
    ?.replace(/[^a-z0-9]/giu, '');
  const named = generate_safe_file_name(part.source, '');
  if (named.includes('.')) return named;
  return `${named || `image-${index + 1}`}.${subtype || 'png'}`;
}
