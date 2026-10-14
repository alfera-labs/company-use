import { format_error_message } from '@coworker/shared';
import {
  chat_attachment_limits,
  find_attachment_rejection_message,
} from '@/components/app/chat_attachment_limits';
import {
  create_pending_chat_attachment,
  type PendingChatAttachment,
} from '@/components/app/chat_file_parts';
import { create_random_id } from '@/lib/random_id';

export type AppendedChatAttachments = {
  attachments: PendingChatAttachment[];
  rejections: string[];
};

export type ChatAttachmentUpdate = {
  id: string;
  changes: Partial<PendingChatAttachment>;
};

export function append_chat_attachments(
  files: readonly File[],
  already_attached: readonly PendingChatAttachment[],
  options: {
    session_id?: string;
    on_attachment_changed: (update: ChatAttachmentUpdate) => void;
  },
): AppendedChatAttachments {
  const rejections: string[] = [];
  const accepted: File[] = [];
  for (const file of files) {
    const rejection = find_attachment_rejection_message(
      file,
      already_attached.length + accepted.length,
    );
    if (rejection) rejections.push(rejection);
    else accepted.push(file);
  }

  const attachments = accepted
    .slice(0, chat_attachment_limits.max_attachment_count)
    .map((file) => start_one_attachment(file, options));

  return { attachments, rejections };
}

function start_one_attachment(
  file: File,
  options: {
    session_id?: string;
    on_attachment_changed: (update: ChatAttachmentUpdate) => void;
  },
): PendingChatAttachment {
  const id = `attachment:${create_random_id()}`;
  const pending: PendingChatAttachment = {
    id,
    name: file.name,
    mime_type: file.type || 'application/octet-stream',
    byte_size: file.size,
    upload_status: 'uploading',
    upload_progress: 0,
  };

  void create_pending_chat_attachment(file, {
    ...(options.session_id ? { session_id: options.session_id } : {}),
    on_progress: (fraction) =>
      options.on_attachment_changed({ id, changes: { upload_progress: fraction } }),
  })
    .then((resolved) =>
      options.on_attachment_changed({
        id,
        changes: {
          part: resolved.part,
          mime_type: resolved.mime_type,
          upload_status: 'ready',
          upload_progress: 1,
        },
      }),
    )
    .catch((error: unknown) =>
      options.on_attachment_changed({
        id,
        changes: {
          upload_status: 'failed',
          upload_error: format_error_message(error, 'Upload failed'),
        },
      }),
    );

  return pending;
}
