// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { UserPlus } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  append_chat_attachments,
  type ChatAttachmentUpdate,
} from '@/components/app/append_chat_attachments';
import { remember_new_chat_composer_place } from '@/components/app/chat_composer_dock';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import { ChatProjectPicker } from '@/components/app/chat_project_picker';
import { ChatPromptInput } from '@/components/app/chat_prompt_input';
import type { PromptSuggestionGroup } from '@/components/app/chat_prompt_suggestions';
import { write_chat_route_handoff } from '@/components/app/chat_route_handoff';
import { HomeGreeting } from '@/components/app/home_greeting';
import {
  useCompanyScanSuggestions,
  useDeferredHomeSuggestionApps,
} from '@/components/app/home_suggestions';
import { HomeTaskGallery } from '@/components/app/home_task_gallery';
import { HomeSlackStrip } from '@/components/app/slack/home_strip';
import { usePrefetchChatPaywall } from '@/components/app/use_chat_paywall';
import { use_starter_prompt } from '@/components/app/use_starter_prompt';
import { use_is_plain_team_member } from '@/components/app/use_team_mode';
import type { CatalogApp } from '@/lib/api';
import { settings_section_path } from '@/lib/settings_navigation';

export function HomeChatSurface() {
  const [message_text, set_message_text] = useState('');
  const home_suggestion_apps = useDeferredHomeSuggestionApps();
  const company_scan_groups = useCompanyScanSuggestions();
  const search: { prompt?: string } = useSearch({ strict: false });
  const starter_prompt = typeof search.prompt === 'string' ? search.prompt : null;
  const type_into_composer = use_starter_prompt({ starter_prompt, message_text, set_message_text });

  const write_template_into_composer = useCallback(
    (setup_message: string) => {
      type_into_composer(setup_message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [type_into_composer],
  );

  return (
    <section className="@container/main flex h-dvh flex-col bg-background text-foreground">
      <HomeSlackStrip />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InviteUsersLink />
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-16 md:pt-14">
          <HomeGreeting />
          <div className="mt-6">
            <HomeComposer
              apps={home_suggestion_apps}
              extraSuggestionGroups={company_scan_groups}
              value={message_text}
              onValueChange={set_message_text}
            />
          </div>
          <div className="mt-7">
            <HomeTaskGallery
              apps={home_suggestion_apps}
              onSelectTemplate={write_template_into_composer}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function HomeComposer({
  apps,
  extraSuggestionGroups,
  value,
  onValueChange,
}: {
  apps: CatalogApp[];
  extraSuggestionGroups: PromptSuggestionGroup[];
  value: string;
  onValueChange: (text: string) => void;
}) {
  const navigate = useNavigate();
  const warm_up_new_chat_page = use_warm_up_of_the_new_chat_page_and_its_paywall_answer();
  const [project_id, set_project_id] = useState<string | null>(null);
  const files = use_home_attachments();
  const project_picker = useMemo(
    () => <ChatProjectPicker project_id={project_id} onProjectChange={set_project_id} />,
    [project_id],
  );
  return (
    <ChatPromptInput
      apps={apps}
      attachments={files.attachments}
      expanded
      extraSuggestionGroups={extraSuggestionGroups}
      isStreaming={false}
      placeholder="Describe a task, or pick one below…"
      projectPicker={project_picker}
      value={value}
      onAttachmentRemove={files.remove}
      onFilesAdded={files.append}
      onSend={() => {
        remember_new_chat_composer_place(document.activeElement?.closest('form'));
        write_chat_route_handoff({
          attachments: files.attachments,
          message_text: value.trim(),
          project_id,
        });
        navigate({ href: '/chats' });
      }}
      onStop={() => {}}
      onValueChange={(text) => {
        if (value === '') warm_up_new_chat_page();
        onValueChange(text);
      }}
    />
  );
}

function use_warm_up_of_the_new_chat_page_and_its_paywall_answer() {
  const router = useRouter();
  const prefetch_chat_paywall = usePrefetchChatPaywall();
  return () => {
    void router.preloadRoute({ to: '/chats/{-$session_id}', params: {} });
    prefetch_chat_paywall();
  };
}

const InviteUsersLink = memo(function InviteUsersLink() {
  if (use_is_plain_team_member()) return null;
  return (
    <div className="flex w-full justify-end px-4 pt-3 sm:px-6">
      <Link
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        to={settings_section_path('team')}
      >
        <UserPlus className="size-3.5" />
        Invite users
      </Link>
    </div>
  );
});

function use_home_attachments() {
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
  return {
    attachments,
    append: (files: File[]) => {
      const appended = append_chat_attachments(files, attachments, {
        on_attachment_changed: apply_attachment_update,
      });
      for (const rejection of appended.rejections) toast.error(rejection);
      set_attachments((items) => [...items, ...appended.attachments].slice(0, 20));
    },
    remove: (id: string) => set_attachments((items) => items.filter((item) => item.id !== id)),
  };
}
