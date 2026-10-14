import { format_error_message } from '@coworker/shared';
import { cn } from '@coworker/ui/lib/utils';
import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { format_byte_size } from '@/components/app/chat_attachment_limits';
import { download_file } from '@/lib/api/download_file';

export type ChatMessageFile = {
  key: string;
  file_id?: string;
  name?: string;
  mime_type?: string;
  is_inline_text?: boolean;
};

export function ChatMessageFiles({ files }: { files: readonly ChatMessageFile[] }) {
  if (files.length === 0) return null;

  return (
    <div className="mb-1 flex flex-wrap gap-2">
      {files.map((file) => (
        <ChatMessageFileChip file={file} key={file.key} />
      ))}
    </div>
  );
}

export type ChatMessageImage = {
  key: string;
  data_url: string;
  name?: string;
};

export function ChatMessageImages({ images }: { images: readonly ChatMessageImage[] }) {
  if (images.length === 0) return null;

  return (
    <div className="mb-1 flex flex-wrap gap-2">
      {images.map((image) => (
        <button
          className="overflow-hidden rounded-2xl border border-border transition-opacity hover:opacity-90"
          key={image.key}
          title={image.name ? `Open ${image.name}` : 'Open image'}
          type="button"
          onClick={() => open_image_in_new_tab(image)}
        >
          <img
            alt={image.name ?? 'Attached image'}
            className="max-h-40 max-w-64 object-cover"
            src={image.data_url}
          />
        </button>
      ))}
    </div>
  );
}

// Browsers refuse to navigate a tab to a data: URL, so this converts to a blob URL instead.
// Revoked on a timer, not immediately: revoking right after open races the tab still loading it.
export function open_image_in_new_tab(image: Pick<ChatMessageImage, 'data_url'>) {
  const [header = '', base64 = ''] = image.data_url.split(',');
  const mime_type = header.slice('data:'.length).replace(';base64', '') || 'image/png';
  const binary = globalThis.atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const object_url = URL.createObjectURL(new Blob([bytes], { type: mime_type }));

  globalThis.open(object_url, '_blank', 'noopener');
  globalThis.setTimeout(() => URL.revokeObjectURL(object_url), 60_000);
}

function ChatMessageFileChip({ file }: { file: ChatMessageFile }) {
  const [is_downloading, set_is_downloading] = useState(false);
  const file_name = file.name ?? 'Attachment';
  const can_download = Boolean(file.file_id) && !file.is_inline_text;

  async function start_download() {
    if (!file.file_id || is_downloading) return;
    set_is_downloading(true);
    try {
      await download_file(file.file_id);
    } catch (error) {
      toast.error(format_error_message(error, `Could not download ${file_name}`));
    } finally {
      set_is_downloading(false);
    }
  }

  return (
    <button
      className={cn(
        'inline-grid max-w-64 grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-2',
        'rounded-3xl border border-border bg-background px-2 py-1.5 text-left text-xs',
        can_download ? 'transition-colors hover:bg-hover' : 'cursor-default opacity-80',
      )}
      disabled={!can_download}
      title={can_download ? `Download ${file_name}` : `${file_name} was sent as text`}
      type="button"
      onClick={start_download}
    >
      <span className="grid size-7 place-items-center rounded-2xl bg-muted font-mono text-[10px] uppercase text-muted-foreground">
        {file_extension(file_name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{file_name}</span>
        <span className="block truncate text-muted-foreground">
          {file.is_inline_text ? 'Sent as text' : (file.mime_type ?? 'File')}
        </span>
      </span>
      {can_download ? (
        is_downloading ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Download className="size-3.5 text-muted-foreground" />
        )
      ) : (
        <span />
      )}
    </button>
  );
}

function file_extension(file_name: string) {
  return file_name.split('.').pop()?.slice(0, 4) || 'file';
}

export { format_byte_size };
