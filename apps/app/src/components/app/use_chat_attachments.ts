import { useState } from 'react';
import { toast } from 'sonner';
import {
  append_chat_attachments,
  type ChatAttachmentUpdate,
} from '@/components/app/append_chat_attachments';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';

const most_attachments = 20;

/** Keeps the files the person attached to the next message, and uploads the new ones. */
export function useChatAttachments(session_id: string | undefined) {
  const [attachments, set_attachments] = useState<PendingChatAttachment[]>([]);
  function apply_attachment_update({ id, changes }: ChatAttachmentUpdate) {
    set_attachments((current) =>
      current.map((attachment) =>
        attachment.id === id ? { ...attachment, ...changes } : attachment,
      ),
    );
    if (changes.upload_status === 'failed') {
      toast.error(changes.upload_error ?? 'A file could not be uploaded.');
    }
  }
  async function append_files(files: File[]) {
    const appended = append_chat_attachments(files, attachments, {
      ...(session_id ? { session_id } : {}),
      on_attachment_changed: apply_attachment_update,
    });
    for (const rejection of appended.rejections) toast.error(rejection);
    set_attachments((current) => [...current, ...appended.attachments].slice(0, most_attachments));
  }
  function remove_attachment(attachment_id: string) {
    set_attachments((items) => items.filter((item) => item.id !== attachment_id));
  }
  return { attachments, set_attachments, append_files, remove_attachment };
}
