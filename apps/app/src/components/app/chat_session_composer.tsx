import { memo, useEffect } from 'react';
import { chat_draft_key } from '@/components/app/chat_draft_storage';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import { ChatProjectPicker } from '@/components/app/chat_project_picker';
import { ChatPromptInput } from '@/components/app/chat_prompt_input';
import { remember_person_stopped_the_reply } from '@/components/app/chat_reply_reveal_state';
import type { CatalogApp } from '@/lib/api';
import { useStableCallback } from '@/lib/use_stable_callback';

type ChatSessionComposerProps = {
  apps: CatalogApp[];
  attachments: PendingChatAttachment[];
  expanded?: boolean;
  isStreaming: boolean;
  onAttachmentRemove: (attachment_id: string) => void;
  onFilesAdded: (files: File[]) => void;
  onSend: () => void;
  onStop: () => void;
  placeholder: string;
  project_id?: string | null;
  onProjectChange?: (project_id: string | null) => void;
  sessionId: string | undefined;
  waitsForHistory?: boolean;
};

export function ChatSessionComposer(props: ChatSessionComposerProps) {
  const remove_attachment = useStableCallback(props.onAttachmentRemove);
  const add_files = useStableCallback(props.onFilesAdded);
  const send = useStableCallback(props.onSend);
  const stop = useStableCallback(() => {
    remember_person_stopped_the_reply();
    props.onStop();
  });
  return (
    <ComposerWithDraft
      {...props}
      onAttachmentRemove={remove_attachment}
      onFilesAdded={add_files}
      onSend={send}
      onStop={stop}
    />
  );
}

const ComposerWithDraft = memo(function ComposerWithDraft({
  apps,
  attachments,
  expanded,
  isStreaming,
  onAttachmentRemove,
  onFilesAdded,
  onSend,
  onStop,
  placeholder,
  project_id,
  onProjectChange,
  sessionId,
  waitsForHistory,
}: ChatSessionComposerProps) {
  const draft_key = chat_draft_key(sessionId);
  const draft_value = useChatDraftStore((state) => state.draft_by_key[draft_key] ?? '');
  const set_draft = useChatDraftStore((state) => state.set_draft);
  const load_draft_from_storage = useChatDraftStore((state) => state.load_draft_from_storage);

  useEffect(() => {
    load_draft_from_storage(draft_key);
  }, [draft_key, load_draft_from_storage]);

  return (
    <ChatPromptInput
      apps={apps}
      attachments={attachments}
      expanded={expanded ?? !sessionId}
      isStreaming={isStreaming}
      placeholder={placeholder}
      {...project_picker_props(project_id, onProjectChange)}
      showSuggestions={false}
      value={draft_value}
      waitsForHistory={waitsForHistory ?? false}
      onAttachmentRemove={onAttachmentRemove}
      onFilesAdded={onFilesAdded}
      onSend={onSend}
      onStop={onStop}
      onValueChange={(value) => set_draft(draft_key, value)}
    />
  );
});

function project_picker_props(
  project_id: string | null | undefined,
  onProjectChange: ((project_id: string | null) => void) | undefined,
) {
  if (!onProjectChange) return {};
  return {
    projectPicker: (
      <ChatProjectPicker project_id={project_id ?? null} onProjectChange={onProjectChange} />
    ),
  };
}
