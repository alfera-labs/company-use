import type { SessionEnv } from '@agent-core/environment';
import { AppError, format_error_message } from '@coworker/shared';
import { mime_type_for_file_name } from '@runtime-platform/files/file_mime_types';
import type { ReplyAttachment } from '@runtime-platform/tools/gmail/reply_mime';

/** Gmail's own ceiling for the files on one message. */
export const max_total_attachment_bytes = 25 * 1024 * 1024;

const web_page_openings = ['<!do', '<htm'];

/**
 * Reads the files from the run's workspace. Names pair with paths by position; a missing name
 * falls back to the file's own name.
 */
export async function read_reply_attachments(
  environment: SessionEnv | undefined,
  input: { file_paths: string[]; file_names: string[] },
): Promise<ReplyAttachment[]> {
  if (input.file_paths.length === 0) return [];
  const read_bytes = environment?.read_bytes;
  if (!read_bytes) {
    throw new AppError(
      'workspace_unavailable',
      'The runtime workspace is not available, so the files cannot be attached.',
      409,
    );
  }
  const attachments = await Promise.all(
    input.file_paths.map(async (file_path, index) => {
      const bytes = await read_workspace_file(read_bytes, file_path);
      const file_name = input.file_names[index]?.trim() || file_name_from_path(file_path);
      reject_web_page(file_path, bytes);
      const mime_type = mime_type_for_file_name(file_path, mime_type_for_file_name(file_name));
      return { file_name, mime_type, bytes };
    }),
  );
  reject_oversized_total(attachments);
  return attachments;
}

function reject_web_page(file_path: string, bytes: Uint8Array) {
  const opening = Buffer.from(bytes.subarray(0, 64))
    .toString('utf8')
    .trimStart()
    .slice(0, 4)
    .toLowerCase();
  if (!web_page_openings.includes(opening)) return;
  throw new AppError(
    'attachment_is_a_web_page',
    `${file_path} is a web page (HTML), not the file its name claims. It is probably a sign-in page saved from a private link. Download the real file and attach that.`,
    422,
  );
}

function reject_oversized_total(attachments: ReplyAttachment[]) {
  const total_bytes = attachments.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (total_bytes <= max_total_attachment_bytes) return;
  const total_mb = (total_bytes / 1024 / 1024).toFixed(1);
  throw new AppError(
    'attachments_too_large',
    `The attachments add up to ${total_mb} MB. Gmail allows 25 MB per message. Attach fewer or smaller files, or share a link instead.`,
    422,
  );
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
