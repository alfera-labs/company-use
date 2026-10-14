import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Textarea } from '@coworker/ui/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { File as FileIcon, Loader2, Paperclip, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ChatAttachmentTray } from '@/components/app/chat_attachment_tray';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import {
  let_alfera_recommend,
  type ModelChoice,
  selected_model_choice,
} from '@/components/app/model_picker/model_choice';
import { ModelPicker } from '@/components/app/model_picker/model_picker';
import { useModelOptions } from '@/components/app/model_picker/use_model_options';
import { RetryButton } from '@/components/app/retry_button';
import { ScheduledTaskInstructionField } from '@/components/app/scheduled_task_instruction_field';
import { useMainAgent } from '@/components/app/use_main_agent';
import { FileUpload, FileUploadTrigger } from '@/components/prompt-kit/file-upload';
import { list_workspace_files, workspace_file_download_url } from '@/lib/api';
import { api_fetch } from '@/lib/api/client';
import { query_keys } from '@/lib/api/query_keys';

const default_agent_value = 'default-agent';

export function ScheduledTaskInstructions({
  instruction,
  onInstructionChange,
  agentId,
  onAgentIdChange,
  modelChoice,
  onModelChoiceChange,
  attachments,
  onFilesAdded,
  onFileSelectionPendingChange,
  onAttachmentRemove,
  contextDigest,
  onContextDigestChange,
}: {
  instruction: string;
  onInstructionChange: (value: string) => void;
  agentId: string | null;
  onAgentIdChange: (agent_id: string | null) => void;
  modelChoice: ModelChoice;
  onModelChoiceChange: (choice: ModelChoice) => void;
  attachments: PendingChatAttachment[];
  onFilesAdded: (files: File[]) => void;
  onFileSelectionPendingChange: (is_pending: boolean) => void;
  onAttachmentRemove: (attachment_id: string) => void;
  contextDigest?: string;
  onContextDigestChange?: (value: string) => void;
}) {
  const [file_menu_open, set_file_menu_open] = useState(false);
  const [selecting_file_name, set_selecting_file_name] = useState<string | null>(null);
  const agents_query = useMainAgent();
  const models_query = useModelOptions();
  const files_query = useQuery({
    queryKey: query_keys.workspace_files('files'),
    queryFn: () => list_workspace_files('files'),
    enabled: file_menu_open,
  });
  const agents = agents_query.data ?? [];
  const selected_agent = agents.find((agent) => agent.agent_id === agentId) ?? agents_query.agent;
  const inherited_choice = selected_agent
    ? selected_model_choice(selected_agent)
    : let_alfera_recommend;

  async function select_workspace_file(file_name: string) {
    const file_path = `files/${file_name}`;
    set_selecting_file_name(file_name);
    onFileSelectionPendingChange(true);
    try {
      const response = await api_fetch(workspace_file_download_url(file_path));
      if (!response.ok) throw new Error(`Could not read ${file_name}`);
      const mime_type = response.headers.get('content-type') || 'application/octet-stream';
      onFilesAdded([new globalThis.File([await response.blob()], file_name, { type: mime_type })]);
    } catch (error) {
      toast.error(format_error_message(error, `Could not read ${file_name}`));
    } finally {
      set_selecting_file_name(null);
      onFileSelectionPendingChange(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-background focus-within:ring-2 focus-within:ring-ring/40">
      <div className="border-b p-3">
        {agents_query.isLoading ? (
          <Skeleton className="h-9 w-44 rounded-xl" />
        ) : agents_query.isError ? (
          <RetryButton label="Retry loading agents" onRetry={() => void agents_query.refetch()} />
        ) : (
          <Select
            value={agentId ?? default_agent_value}
            onValueChange={(value) =>
              onAgentIdChange(
                value === default_agent_value
                  ? (agents_query.agent?.agent_id ?? null)
                  : String(value),
              )
            }
          >
            <SelectTrigger className="h-9 min-w-44 rounded-xl" aria-label="Task agent">
              <SelectValue>
                {agentId
                  ? (selected_agent?.agent_name ?? 'Select agent')
                  : 'Select agent (optional)'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={default_agent_value}>Use the default agent</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.agent_id} value={agent.agent_id}>
                  {agent.agent_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <ScheduledTaskInstructionField value={instruction} on_change={onInstructionChange} />

      {contextDigest !== undefined && onContextDigestChange ? (
        <Textarea
          className="min-h-20 resize-none rounded-none border-x-0 border-b-0 px-3 py-3 shadow-none focus-visible:ring-0"
          aria-label="Task background"
          placeholder="Background the task should remember"
          value={contextDigest}
          onChange={(event) => onContextDigestChange(event.target.value)}
        />
      ) : null}

      <ChatAttachmentTray attachments={attachments} onRemove={onAttachmentRemove} />
      <div className="flex items-center justify-between gap-2 p-2">
        <FileUpload onFilesAdded={onFilesAdded}>
          <DropdownMenu open={file_menu_open} onOpenChange={set_file_menu_open}>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label="Add or select files"
                  className="size-9 rounded-full text-muted-foreground"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {selecting_file_name ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-52">
              <FileUploadTrigger>
                <DropdownMenuItem>
                  <Paperclip />
                  Add files
                </DropdownMenuItem>
              </FileUploadTrigger>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Select file</DropdownMenuLabel>
              {files_query.isLoading ? (
                <DropdownMenuLabel className="flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" /> Loading files
                </DropdownMenuLabel>
              ) : files_query.isError ? (
                <DropdownMenuItem onClick={() => void files_query.refetch()}>
                  <RefreshCw /> Retry loading files
                </DropdownMenuItem>
              ) : files_query.data?.files.length ? (
                files_query.data.files.map((file) => {
                  return (
                    <DropdownMenuItem
                      disabled={selecting_file_name !== null}
                      key={file.file_name}
                      onClick={() => void select_workspace_file(file.file_name)}
                    >
                      {selecting_file_name === file.file_name ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <FileIcon />
                      )}
                      <span className="truncate">{file.file_name}</span>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuLabel>No workspace files</DropdownMenuLabel>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </FileUpload>
        {models_query.isLoading ? (
          <Skeleton className="h-8 w-24 rounded-full" />
        ) : models_query.isError ? (
          <RetryButton label="Retry loading models" onRetry={() => void models_query.refetch()} />
        ) : models_query.models.length > 0 ? (
          <ModelPicker
            inheritedChoice={inherited_choice}
            models={models_query.models}
            size="inline"
            value={modelChoice}
            onChange={onModelChoiceChange}
          />
        ) : (
          <RetryButton label="Retry loading models" onRetry={() => void models_query.refetch()} />
        )}
      </div>
    </div>
  );
}
