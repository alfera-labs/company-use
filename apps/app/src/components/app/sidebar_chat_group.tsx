import { SidebarMenu } from '@coworker/ui/components/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@coworker/ui/components/tooltip';
import { cn } from '@coworker/ui/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import {
  Building2,
  ChevronDown,
  FolderOpen,
  Lock,
  type LucideIcon,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppNavLink } from '@/components/app/app_nav_link';
import type { ChatRoomGroup, ChatRoomGroupKind } from '@/components/app/chat_room_groups';
import { SidebarChatLink } from '@/components/app/sidebar_chat_link';
import { create_session } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

const group_icons = {
  personal: Lock,
  project: FolderOpen,
  workspace: Building2,
  unplaced: MessageSquare,
} as const satisfies Record<ChatRoomGroupKind, LucideIcon>;

export function SidebarChatGroup({ group }: { group: ChatRoomGroup }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const [is_open, set_is_open] = useState(true);
  const Icon = group_icons[group.group_kind];

  const start_chat = useMutation({
    mutationFn: () => create_session(group.project_id ? { project_id: group.project_id } : {}),
    onSuccess: (session) => {
      query_client.invalidateQueries({ queryKey: query_keys.sessions() });
      navigate({ href: `/chats/${session.session_id}` });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const room_href = group.group_kind === 'project' ? `/projects/${group.project_id}` : null;
  const selected_session_id = pathname.startsWith('/chats/') ? pathname.split('/')[2] : undefined;

  return (
    <div>
      <div className="flex h-7 items-center gap-1 pr-1 pl-1 text-muted-foreground">
        <button
          type="button"
          aria-expanded={is_open}
          aria-label={is_open ? `Hide ${group.group_name} chats` : `Show ${group.group_name} chats`}
          className="grid size-5 shrink-0 place-items-center rounded-xl transition-colors hover:bg-hover hover:text-foreground"
          onClick={() => set_is_open(!is_open)}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 transition-transform duration-150',
              is_open ? '' : '-rotate-90',
            )}
          />
        </button>
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <RoomName href={room_href} name={group.group_name} onToggle={() => set_is_open(!is_open)} />
        <span className="shrink-0 text-[0.6875rem] tabular-nums">
          {group.sessions.length || ''}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`New chat in ${group.group_name}`}
                disabled={start_chat.isPending}
                className="grid size-5 shrink-0 place-items-center rounded-xl transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
                onClick={() => start_chat.mutate()}
              />
            }
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="right">New chat in {group.group_name}</TooltipContent>
        </Tooltip>
      </div>

      {is_open ? (
        <div className="ml-3 border-border/70 border-l pl-1">
          {group.sessions.length === 0 ? (
            <p className="px-2 py-1 text-[0.6875rem] text-muted-foreground">No chats yet</p>
          ) : (
            <SidebarMenu>
              {group.sessions.map((session) => (
                <SidebarChatLink
                  isActive={session.session_id === selected_session_id}
                  isUnread={session.is_unread === true}
                  key={session.session_id}
                  session={session}
                />
              ))}
            </SidebarMenu>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RoomName({
  href,
  name,
  onToggle,
}: {
  href: string | null;
  name: string;
  onToggle: () => void;
}) {
  const class_name =
    'min-w-0 flex-1 truncate text-left font-medium text-foreground text-xs transition-colors hover:text-brand-ink';

  if (!href) {
    return (
      <button className={class_name} onClick={onToggle} type="button">
        {name}
      </button>
    );
  }

  return (
    <AppNavLink className={class_name} href={href}>
      {name}
    </AppNavLink>
  );
}
