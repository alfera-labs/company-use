import { ValidationError } from '@coworker/shared';

export const runtime_attachment_limits = {
  max_attachments: 20,
  max_attachment_bytes: 25 * 1024 * 1024,
  max_request_bytes: 25 * 1024 * 1024,
} as const;

export type RuntimeAttachmentSource = {
  attachment_id: string;
  stored_file_id?: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  open_bytes: () => Promise<ReadableStream<Uint8Array>>;
};

export class AttachmentSizeMismatchError extends ValidationError {
  constructor(
    file_name: string,
    public readonly expected_bytes: number,
    public readonly received_bytes: number,
  ) {
    super(
      received_bytes > expected_bytes
        ? `Attachment ${file_name} exceeded its declared size of ${expected_bytes} bytes`
        : `Attachment ${file_name} ended after ${received_bytes} of ${expected_bytes} bytes`,
    );
  }
}

export function create_runtime_attachment_source_map(sources: RuntimeAttachmentSource[]) {
  if (sources.length > runtime_attachment_limits.max_attachments) {
    throw new ValidationError('A message can include at most 20 binary attachments');
  }
  const total_bytes = sources.reduce((sum, source) => {
    if (!Number.isSafeInteger(source.byte_size) || source.byte_size < 0) {
      throw new ValidationError(`Attachment ${source.file_name} has an invalid byte size`);
    }
    if (source.byte_size > runtime_attachment_limits.max_attachment_bytes) {
      throw new ValidationError(`Attachment ${source.file_name} exceeds 25 MiB`);
    }
    return sum + source.byte_size;
  }, 0);
  if (total_bytes > runtime_attachment_limits.max_request_bytes) {
    throw new ValidationError('Binary attachments in one message must total 25 MiB or less');
  }
  const source_map = new Map(sources.map((source) => [source.attachment_id, source]));
  if (source_map.size !== sources.length)
    throw new ValidationError('Attachment ids must be unique');
  return source_map;
}

export function limit_attachment_stream(source: RuntimeAttachmentSource) {
  let received_bytes = 0;
  return source.open_bytes().then((stream) =>
    stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received_bytes += chunk.byteLength;
          if (received_bytes > source.byte_size) {
            throw new AttachmentSizeMismatchError(
              source.file_name,
              source.byte_size,
              received_bytes,
            );
          }
          controller.enqueue(chunk);
        },
        flush() {
          if (received_bytes !== source.byte_size) {
            throw new AttachmentSizeMismatchError(
              source.file_name,
              source.byte_size,
              received_bytes,
            );
          }
        },
      }),
    ),
  );
}
