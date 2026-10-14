import { SidebarMenuItem } from '@coworker/ui/components/sidebar';
import { cn } from '@coworker/ui/lib/utils';
import { memo, useState } from 'react';
import { AppNavLink } from '@/components/app/app_nav_link';
import { chat_title as read_chat_title } from '@/components/app/chat_title';
import { SidebarChatActions } from '@/components/app/sidebar_chat_actions';
import {
  read_sidebar_chat_activity,
  sidebar_chat_is_active,
} from '@/components/app/sidebar_chat_activity';
import { read_sidebar_channel } from '@/components/app/sidebar_chat_channel';
import { SidebarChatPreview } from '@/components/app/sidebar_chat_preview';
import { SidebarChatRenameInput } from '@/components/app/sidebar_chat_rename_input';
import { SharedChatMark } from '@/components/app/sidebar_shared_chat_mark';
import { useSidebarChatActions } from '@/components/app/use_sidebar_chat_actions';
import type { Session } from '@/lib/api';

export const sidebar_context_row_class_name =
  'flex h-8 min-h-8 w-full min-w-0 items-center gap-2 rounded-2xl px-2 text-left font-normal text-foreground outline-none transition-colors hover:bg-hover active:bg-pressed data-[active=true]:bg-[var(--sidebar-selected)] focus-visible:ring-[3px] focus-visible:ring-ring/30 max-md:min-h-9';

export function read_open_chat_path(pathname: string) {
  return pathname.startsWith('/chats/') ? pathname : null;
}

export function describe_sidebar_chat(
  title: string,
  source: string,
  project: string,
  unread: boolean,
  activity: ReturnType<typeof read_sidebar_chat_activity>,
) {
  return `${title} · ${read_sidebar_channel(source).label} · ${project} · ${unread ? 'Unread' : 'Read'} · ${activity.description}`;
}

type SidebarChatLinkProps = {
  isActive: boolean;
  isUnread?: boolean;
  session: Session;
  project_label?: string;
  project_is_personal?: boolean;
  now?: number;
};

export const SidebarChatLink = memo(function SidebarChatLink({
  isActive,
  isUnread = false,
  session,
  project_label,
  project_is_personal = false,
  now,
}: SidebarChatLinkProps) {
  const actions = useSidebarChatActions(session, isActive);
  const [is_renaming, set_is_renaming] = useState(false);
  const chat_title = read_chat_title(session);
  const activity = read_sidebar_chat_activity(session, now);
  const description = project_label
    ? describe_sidebar_chat(chat_title, session.session_source, project_label, isUnread, activity)
    : undefined;
  if (is_renaming && actions) {
    return (
      <SidebarMenuItem>
        <SidebarChatRenameInput
          chat_title={chat_title}
          className={sidebar_context_row_class_name}
          on_save={actions.rename_this_chat}
          on_done={() => set_is_renaming(false)}
        />
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem className="group/chat-row relative">
      <SidebarChatPreview
        project_label={project_is_personal ? undefined : project_label}
        session={session}
      >
        <AppNavLink
          href={`/chats/${session.session_id}`}
          aria-current={isActive ? 'page' : undefined}
          data-active={isActive ? 'true' : undefined}
          className={sidebar_context_row_class_name}
          title={description}
          aria-label={description}
        >
          <SidebarChatContext
            chat_title={chat_title}
            activity={activity}
            session_source={session.session_source}
            is_unread={isUnread}
            has_row_actions={Boolean(actions)}
            hover_project_label={project_is_personal ? undefined : project_label}
          />
        </AppNavLink>
      </SidebarChatPreview>
      {actions ? (
        <SidebarChatActions
          chat_title={chat_title}
          project_id={session.project_id ?? null}
          on_rename={() => set_is_renaming(true)}
          on_move={actions.move_this_chat}
          on_delete={sidebar_chat_is_active(session) ? undefined : actions.delete_this_chat}
        />
      ) : null}
    </SidebarMenuItem>
  );
});

/**
 * What a chat row says. The title and its marks share one line that wraps and shows only its
 * first line. The project badge comes after them, so it shows whole when it fits beside the
 * whole title and wraps out of sight when it does not: the title is never cut for it.
 */
export function SidebarChatContext({
  chat_title,
  activity,
  is_unread = false,
  session_source = 'dashboard',
  has_row_actions = false,
  hover_project_label,
}: {
  chat_title: string;
  activity: ReturnType<typeof read_sidebar_chat_activity>;
  is_unread?: boolean;
  session_source?: string;
  has_row_actions?: boolean;
  hover_project_label?: string | undefined;
}) {
  const channel = read_sidebar_channel(session_source);
  const Icon = channel.icon;
  return (
    <>
      <span aria-hidden="true" className="size-3.5 shrink-0">
        <Icon className="size-3.5" />
      </span>
      <span
        className={cn(
          'flex h-5 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden',
          has_row_actions &&
            hover_project_label &&
            'md:group-hover/chat-row:pr-11 md:group-focus-within/chat-row:pr-11',
        )}
      >
        <span className="flex h-5 min-w-0 flex-auto items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-auto truncate text-[13px] leading-4 text-foreground',
              is_unread ? 'font-medium' : 'font-normal',
            )}
          >
            {chat_title}
          </span>
          <SharedChatMark project_label={hover_project_label} />
          {is_unread ? <UnreadMark /> : null}
          <span
            title={activity.description}
            className={cn(
              'shrink-0 text-[11px] leading-4 tabular-nums text-muted-foreground',
              has_row_actions &&
                'max-md:pr-11 md:group-hover/chat-row:opacity-0 md:group-focus-within/chat-row:opacity-0',
              hover_project_label &&
                'md:group-hover/chat-row:hidden md:group-focus-within/chat-row:hidden',
            )}
          >
            {activity.working ? (
              <span role="status" aria-label="Chat is running">
                {activity.label}
              </span>
            ) : (
              activity.label
            )}
          </span>
        </span>
        {hover_project_label ? <ProjectBadgeOnHover project_label={hover_project_label} /> : null}
      </span>
    </>
  );
}

function ProjectBadgeOnHover({ project_label }: { project_label: string }) {
  return (
    <span
      aria-hidden="true"
      title={project_label}
      className="hidden max-w-full shrink-0 truncate rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground md:group-hover/chat-row:block md:group-focus-within/chat-row:block"
    >
      {project_label}
    </span>
  );
}

function UnreadMark() {
  return (
    <span aria-label="Unread messages" role="status" className="shrink-0">
      <span aria-hidden="true" className="block size-1.5 rounded-full bg-primary" />
    </span>
  );
}
