import { AppError, format_error_message } from '@coworker/shared';
import type { SendEmailAttachment } from '@runtime-platform/channels/email/resend_api';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';

// Resend's documented ceiling for a whole message is 40 MB; base64 inflates bytes by ~4/3, so
// the raw budget is held well under it for headers, body, and several files.
const max_total_attachment_bytes = 25 * 1024 * 1024;

export async function read_outbound_email_attachments(
  context: RuntimeToolExecutionContext,
  file_paths: string[] | undefined,
): Promise<SendEmailAttachment[]> {
  if (!file_paths?.length) return [];

  const read_bytes = context.environment?.read_bytes;
  if (!read_bytes) {
    throw new AppError(
      'workspace_unavailable',
      'The runtime workspace is not available, so the files cannot be attached.',
      409,
    );
  }

  const attachments: SendEmailAttachment[] = [];
  let total_bytes = 0;
  for (const file_path of file_paths) {
    const bytes = await read_workspace_file(read_bytes, file_path);
    total_bytes += bytes.byteLength;
    if (total_bytes > max_total_attachment_bytes) {
      throw new AppError(
        'email_attachments_too_large',
        'Attachments exceed the 25 MB limit for one email. Send fewer or smaller files, or share a link instead.',
        422,
      );
    }
    attachments.push({
      filename: file_name_from_path(file_path),
      content: Buffer.from(bytes).toString('base64'),
      ...(mime_type_for_file_name(file_path)
        ? { content_type: mime_type_for_file_name(file_path) as string }
        : {}),
    });
  }
  return attachments;
}

async function read_workspace_file(
  read_bytes: (path: string) => Promise<Uint8Array>,
  file_path: string,
) {
  try {
    return await read_bytes(file_path);
  } catch (error) {
    throw new AppError(
      'file_read_failed',
      `Could not read ${file_path} from the workspace: ${format_error_message(error)}`,
      404,
    );
  }
}

function file_name_from_path(file_path: string) {
  return file_path.split('/').filter(Boolean).at(-1) ?? 'attachment';
}

const mime_types_by_extension: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

function mime_type_for_file_name(file_path: string) {
  const extension = file_path.split('.').at(-1)?.toLowerCase() ?? '';
  return mime_types_by_extension[extension];
}
