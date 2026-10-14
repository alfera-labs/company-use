import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { Square } from 'lucide-react';
import type { ClipboardEvent, ReactNode } from 'react';
import { toast } from 'sonner';
import { ChatAttachmentTray } from '@/components/app/chat_attachment_tray';
import {
  files_from_data_transfer,
  type PendingChatAttachment,
} from '@/components/app/chat_file_parts';
import {
  ChatAttachButton,
  ChatSendButton,
  ConnectYourAppsLink,
} from '@/components/app/chat_prompt_input_controls';
import {
  ChatPromptSystem,
  type PromptSuggestionGroup,
} from '@/components/app/chat_prompt_suggestions';
import { ChatModelPicker } from '@/components/app/model_picker/chat_model_picker';
import { FileUpload, useFileDrop } from '@/components/prompt-kit/file-upload';
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from '@/components/prompt-kit/prompt-input';
import type { CatalogApp } from '@/lib/api';

export function ChatPromptInput({
  apps = [],
  attachments,
  attachments_enabled = true,
  read_only = false,
  expanded = false,
  extraSuggestionGroups,
  isStreaming,
  model_control = <ChatModelPicker />,
  onAttachmentRemove,
  onFilesAdded,
  onSend,
  onStop,
  onSuggestion,
  onValueChange,
  placeholder = 'Ask Alfera to…',
  projectPicker,
  showSuggestions = false,
  value,
  waitsForHistory = false,
}: {
  apps?: CatalogApp[];
  attachments: PendingChatAttachment[];
  attachments_enabled?: boolean;
  read_only?: boolean;
  expanded?: boolean;
  extraSuggestionGroups?: PromptSuggestionGroup[];
  isStreaming: boolean;
  model_control?: ReactNode;
  onAttachmentRemove: (attachment_id: string) => void;
  onFilesAdded: (files: File[]) => void;
  onSend: () => void;
  onStop: () => void;
  onSuggestion?: (suggestion: string) => void;
  onValueChange: (value: string) => void;
  placeholder?: string;
  projectPicker?: ReactNode;
  showSuggestions?: boolean;
  value: string;
  waitsForHistory?: boolean;
}) {
  const uploading_count = count_uploads(attachments, 'uploading');
  const failed_count = count_uploads(attachments, 'failed');
  const has_content = Boolean(value.trim() || attachments.length > 0);
  const can_submit = has_content && uploading_count === 0 && failed_count === 0 && !waitsForHistory;
  const blocked_reason = describe_send_block(uploading_count, failed_count);

  function attempt_send() {
    if (can_submit) {
      onSend();
      return;
    }
    if (has_content && blocked_reason) toast.error(blocked_reason);
  }
  const show_stop = isStreaming && !can_submit;
  const file_drop = useFileDrop(onFilesAdded);

  function attach_pasted_files(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = files_from_data_transfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    onFilesAdded(files);
  }

  return (
    <form
      className={cn(
        'relative flex w-full flex-col gap-4',
        file_drop.isDragging && 'rounded-4xl ring-2 ring-ring/40',
      )}
      onDragLeave={file_drop.onDragLeave}
      onDragOver={file_drop.onDragOver}
      onDrop={file_drop.onDrop}
      onSubmit={(event) => {
        event.preventDefault();
        attempt_send();
      }}
    >
      {showSuggestions && onSuggestion ? (
        <ChatPromptSystem
          apps={apps}
          extraGroups={extraSuggestionGroups ?? []}
          value={value}
          onSuggestion={onSuggestion}
          onValueChange={onValueChange}
        />
      ) : null}
      <div className="relative order-2 px-2 pb-3 sm:pb-4 md:order-1">
        <FileUpload onFilesAdded={onFilesAdded}>
          <PromptInput
            className={cn('relative z-10', expanded && 'rounded-2xl p-2 shadow-sm')}
            disabled={waitsForHistory}
            maxHeight={200}
            value={value}
            onSubmit={attempt_send}
            onValueChange={onValueChange}
          >
            <ChatAttachmentTray attachments={attachments} onRemove={onAttachmentRemove} />
            <PromptInputActions
              className={cn('gap-1', expanded ? 'flex-wrap items-center' : 'items-end')}
            >
              <ChatAttachButton disabled={!attachments_enabled} />
              <PromptInputTextarea
                className={cn(
                  'min-h-[36px] flex-1 px-2 py-[8px] text-base leading-[1.4]',
                  expanded && 'order-first min-h-[72px] basis-full px-3 py-2',
                )}
                data-tour="composer"
                readOnly={read_only}
                autoFocus={!read_only}
                placeholder={placeholder}
                onPaste={attach_pasted_files}
              />
              <div className={expanded ? 'ml-auto flex items-center' : 'contents'}>
                {model_control}
              </div>
              {expanded ? null : projectPicker}
              {show_stop ? (
                <PromptInputAction tooltip="Stop">
                  <Button
                    aria-label="Stop response"
                    className="size-9 shrink-0 rounded-full transition-transform duration-150 ease-out active:scale-95"
                    size="sm"
                    type="button"
                    onClick={onStop}
                  >
                    <Square className="size-3.5 fill-current" strokeWidth={0} />
                  </Button>
                </PromptInputAction>
              ) : (
                <ChatSendButton
                  can_submit={can_submit}
                  expanded={expanded}
                  tooltip={blocked_reason ?? 'Send'}
                />
              )}
            </PromptInputActions>
          </PromptInput>
        </FileUpload>
        {expanded ? (
          <div className="-mt-2 flex h-12 items-center gap-3 rounded-b-2xl border border-t-0 bg-background px-3 pt-2 text-sm text-muted-foreground">
            <div className="min-w-0 flex-1">{projectPicker}</div>
            <ConnectYourAppsLink />
          </div>
        ) : null}
      </div>
    </form>
  );
}

function count_uploads(attachments: PendingChatAttachment[], upload_status: string) {
  return attachments.filter((attachment) => attachment.upload_status === upload_status).length;
}

function describe_send_block(uploading_count: number, failed_count: number) {
  if (uploading_count > 0) {
    return uploading_count === 1
      ? 'Still uploading your file — one moment.'
      : `Still uploading ${uploading_count} files — one moment.`;
  }
  if (failed_count > 0) {
    return failed_count === 1
      ? 'One file failed to upload. Remove it or try again.'
      : `${failed_count} files failed to upload. Remove them or try again.`;
  }
  return null;
}
