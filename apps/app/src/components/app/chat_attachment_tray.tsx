import { cn } from '@coworker/ui/lib/utils';
import { Loader2, TriangleAlert, X } from 'lucide-react';
import { format_byte_size } from '@/components/app/chat_attachment_limits';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import { open_image_in_new_tab } from '@/components/app/chat_message_files';

export function ChatAttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: PendingChatAttachment[];
  onRemove: (attachment_id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-3 pt-2">
      {attachments.map((attachment) => {
        const image_data_url = attachment_image_data_url(attachment);
        return (
          <div
            className={cn(
              'relative grid max-w-52 shrink-0 grid-cols-[minmax(0,1fr)_24px] items-center',
              'overflow-hidden rounded-2xl border bg-background text-xs',
              attachment.upload_status === 'failed' ? 'border-destructive/50' : 'border-border',
            )}
            key={attachment.id}
          >
            <button
              className={cn(
                'grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2 px-2 py-2 text-left',
                image_data_url ? 'transition-colors hover:bg-hover' : 'cursor-default',
              )}
              disabled={!image_data_url}
              title={
                attachment.upload_status === 'failed'
                  ? attachment.upload_error
                  : image_data_url
                    ? `Open ${attachment.name}`
                    : attachment.name
              }
              type="button"
              onClick={() => {
                if (image_data_url) open_image_in_new_tab({ data_url: image_data_url });
              }}
            >
              <AttachmentBadge attachment={attachment} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{attachment.name}</span>
                <span
                  className={cn(
                    'block truncate',
                    attachment.upload_status === 'failed'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {attachment_status_text(attachment)}
                </span>
              </span>
            </button>
            <button
              aria-label={`Remove ${attachment.name}`}
              className="grid h-full place-items-center pr-2 text-muted-foreground hover:text-foreground"
              title="Remove"
              type="button"
              onClick={() => onRemove(attachment.id)}
            >
              <X className="size-3.5" />
            </button>
            {attachment.upload_status === 'uploading' ? (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transition-[width] duration-200 ease-out"
                style={{ width: `${Math.round(attachment.upload_progress * 100)}%` }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AttachmentBadge({ attachment }: { attachment: PendingChatAttachment }) {
  if (attachment.upload_status === 'uploading') {
    return (
      <span className="grid size-8 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </span>
    );
  }
  if (attachment.upload_status === 'failed') {
    return (
      <span className="grid size-8 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-4" />
      </span>
    );
  }
  const image_data_url = attachment_image_data_url(attachment);
  if (image_data_url) {
    return (
      <img alt={attachment.name} className="size-8 rounded-2xl object-cover" src={image_data_url} />
    );
  }

  return (
    <span className="grid size-8 place-items-center rounded-2xl bg-muted font-mono text-[10px] uppercase text-muted-foreground">
      {file_extension(attachment.name)}
    </span>
  );
}

function attachment_image_data_url(attachment: PendingChatAttachment) {
  if (attachment.part?.type !== 'image') return null;
  return `data:${attachment.part.mime_type};base64,${attachment.part.data}`;
}

function attachment_status_text(attachment: PendingChatAttachment) {
  if (attachment.upload_status === 'failed') return 'Upload failed';
  if (attachment.upload_status === 'uploading') {
    return `Uploading ${Math.round(attachment.upload_progress * 100)}%`;
  }
  return format_byte_size(attachment.byte_size);
}

function file_extension(file_name: string) {
  return file_name.split('.').pop()?.slice(0, 4) || 'file';
}
