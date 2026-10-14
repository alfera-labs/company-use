import type { SessionEnv } from '@agent-core/environment';
import { ValidationError } from '@coworker/shared';
import {
  AttachmentSizeMismatchError,
  limit_attachment_stream,
  type RuntimeAttachmentSource,
} from '@runtime-platform/attachments/runtime_attachment_source';
import {
  generate_safe_file_name,
  generate_safe_path_segment,
} from '@runtime-platform/files/safe_file_name';

const maximum_write_attempts = 3;
const attachment_directory = 'tmp/attachments';

function generate_attachment_workspace_path(attachment: {
  attachment_id: string;
  file_name: string;
}) {
  const safe_id = generate_safe_path_segment(attachment.attachment_id, '');
  if (!safe_id) throw new ValidationError('Attachment id cannot form a safe path');
  return `${attachment_directory}/${safe_id}/${generate_safe_file_name(attachment.file_name)}`;
}

export async function write_attachment_to_environment(
  environment: SessionEnv | undefined,
  attachment: RuntimeAttachmentSource,
): Promise<string> {
  const write_bytes = environment?.write_bytes;
  const stat = environment?.stat;
  if (!write_bytes || !stat) {
    throw new ValidationError('The current session cannot materialize binary attachments');
  }

  const attachment_path = generate_attachment_workspace_path(attachment);
  const opened_bytes =
    attachment.byte_size === 0 ? await limit_attachment_stream(attachment) : undefined;
  const existing = await stat(attachment_path);
  if (existing?.kind === 'symlink') {
    throw new ValidationError('Attachment path cannot be a symlink');
  }
  if (existing?.kind === 'file' && existing.byte_size === attachment.byte_size) {
    await opened_bytes?.cancel();
    return attachment_path;
  }
  if (existing && existing.kind !== 'file') {
    throw new ValidationError('Attachment path is not a regular file');
  }

  await write_complete_attachment({ write_bytes, stat }, attachment, attachment_path, opened_bytes);
  return attachment_path;
}

async function write_complete_attachment(
  environment: Required<Pick<SessionEnv, 'write_bytes' | 'stat'>>,
  attachment: RuntimeAttachmentSource,
  attachment_path: string,
  first_stream: ReadableStream<Uint8Array> | undefined,
) {
  let next_stream = first_stream;
  for (let attempt = 1; attempt <= maximum_write_attempts; attempt += 1) {
    try {
      const stream = next_stream ?? (await limit_attachment_stream(attachment));
      next_stream = undefined;
      await environment.write_bytes(attachment_path, stream);
    } catch (error) {
      if (is_retryable_attachment_error(error) && attempt < maximum_write_attempts) continue;
      throw error;
    }

    const written = await environment.stat(attachment_path);
    if (written?.kind === 'file' && written.byte_size === attachment.byte_size) return;
    if (written?.kind === 'symlink') {
      throw new ValidationError('Attachment path cannot be a symlink');
    }
    const short_write = written?.kind === 'file' && written.byte_size < attachment.byte_size;
    if (!short_write || attempt === maximum_write_attempts) {
      throw new ValidationError('Attachment bytes were not written completely');
    }
  }
}

function is_retryable_attachment_error(error: unknown) {
  if (!(error instanceof ValidationError)) return true;
  return (
    error instanceof AttachmentSizeMismatchError && error.received_bytes < error.expected_bytes
  );
}
