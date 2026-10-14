import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';

export function inline_text_attachment_id(run_id: string, part_index: number) {
  return `inline-text-${run_id}-${part_index + 1}`;
}

export function create_inline_text_attachment_sources(
  run_id: string,
  parts: readonly RuntimeAgentMessagePart[],
): RuntimeAttachmentSource[] {
  return parts.flatMap((part, index) => {
    if (part.type !== 'file' || !part.text || part.path) return [];
    const bytes = new TextEncoder().encode(part.text);
    return [
      {
        attachment_id: part.file_id ?? inline_text_attachment_id(run_id, index),
        file_name: part.name ?? `attachment-${index + 1}.txt`,
        mime_type: part.mime_type ?? 'text/plain',
        byte_size: bytes.byteLength,
        open_bytes: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      },
    ];
  });
}
