import { Button } from '@coworker/ui/components/button';
import { ScrollArea } from '@coworker/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  sidebar_menu_item_class_name,
} from '@coworker/ui/components/sidebar';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { cn } from '@coworker/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { Building2, ChevronDown, ChevronRight, FolderOpen, Plus } from 'lucide-react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { AppNavLink } from '@/components/app/app_nav_link';
import {
  read_shared_rooms,
  room_label,
  workspace_room_name,
} from '@/components/app/chat_room_label';
import { NewProjectDialog } from '@/components/app/new_project_dialog';
import { sidebar_chat_is_active } from '@/components/app/sidebar_chat_activity';
import { read_open_chat_path, SidebarChatLink } from '@/components/app/sidebar_chat_link';
import { running_chat_list_poll_ms } from '@/components/app/use_finished_chat_sessions';
import { get_current_workspace, list_projects, list_sessions } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project, Session } from '@/lib/api/types';

export const SidebarChatRooms = memo(function SidebarChatRooms() {
  const pathname = useLocation({ select: (location) => read_open_chat_path(location.pathname) });
  const [scope, set_scope] = useState('all');
  const [projects_open, set_projects_open] = useState(true);
  const [now, set_now] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => set_now(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const sessions_query = useQuery({
    queryKey: query_keys.sessions(),
    queryFn: list_sessions,
    refetchInterval: (query) =>
      (query.state.data ?? []).some(sidebar_chat_is_active) ? running_chat_list_poll_ms : false,
  });
  const projects_query = useQuery({
    queryKey: query_keys.projects(''),
    queryFn: () => list_projects(),
  });
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const workspace_name = workspace_query.data?.workspace_name;
  const rooms = projects_query.data ?? [];
  const active_scope = rooms.some((room) => room.project_id === scope) ? scope : 'all';
  const default_project_id = rooms.find((room) => room.is_workspace_default)?.project_id;
  const sessions = [...(sessions_query.data ?? [])]
    .filter(
      (session) =>
        active_scope === 'all' || (session.project_id ?? default_project_id) === active_scope,
    )
    .sort((left, right) => session_time(right) - session_time(left));
  const projects = read_shared_rooms(rooms)
    .sort((left, right) => Number(right.is_workspace_default) - Number(left.is_workspace_default))
    .slice(0, 4);

  return (
    <>
      <SidebarProjectsSection>
        <SidebarProjectsHeading
          projects_open={projects_open}
          on_toggle={() => set_projects_open(!projects_open)}
          actions={
            <>
              <AppNavLink
                href="/projects"
                className="text-[13px] leading-5 text-muted-foreground hover:text-foreground"
              >
                View all
              </AppNavLink>
              <NewProjectButton />
            </>
          }
        />
        {projects_query.isError ? (
          <SidebarReadError
            message="Could not load projects."
            on_retry={() => void projects_query.refetch()}
          />
        ) : null}
        {workspace_query.isError ? (
          <SidebarReadError
            message="Could not load the company name."
            on_retry={() => void workspace_query.refetch()}
          />
        ) : null}
        <div
          id="sidebar-project-shortcuts"
          hidden={!projects_open}
          className="min-h-0 overflow-y-auto overscroll-contain"
        >
          {projects_query.isLoading ? (
            <SidebarRowsSkeleton />
          ) : projects_query.data || !projects_query.isError ? (
            <SidebarProjectRows projects={projects} workspace_name={workspace_name} />
          ) : null}
        </div>
      </SidebarProjectsSection>
      <SidebarRecentSection>
        <SidebarRecentHeading
          filter={
            <SidebarChatFilter
              value={active_scope}
              onValueChange={set_scope}
              options={[
                { value: 'all', label: 'All chats' },
                ...rooms.map((room) => ({
                  value: room.project_id,
                  label: room_label(room.project_id, rooms, workspace_name),
                })),
              ]}
            />
          }
        />
        {sessions_query.isError ? (
          <SidebarReadError
            message="Could not load chats."
            on_retry={() => void sessions_query.refetch()}
          />
        ) : null}
        <ScrollArea className="min-h-0 flex-1 max-md:max-h-[50vh]">
          {sessions_query.isLoading || projects_query.isLoading ? (
            <SidebarRowsSkeleton />
          ) : sessions.length ? (
            <SidebarMenu>
              {sessions.map((session) => {
                const project = rooms.find((room) => room.project_id === session.project_id);
                return (
                  <SidebarChatLink
                    key={session.session_id}
                    session={session}
                    now={now}
                    isActive={pathname === `/chats/${session.session_id}`}
                    isUnread={session.is_unread === true}
                    project_label={room_label(session.project_id ?? null, rooms, workspace_name)}
                    project_is_personal={Boolean(project?.personal_for_user_id)}
                  />
                );
              })}
            </SidebarMenu>
          ) : !sessions_query.isError ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {active_scope === 'all' ? 'No chats yet' : 'No chats in this project'}
            </p>
          ) : null}
        </ScrollArea>
      </SidebarRecentSection>
    </>
  );
});

export function SidebarChatFilter({
  value,
  options,
  onValueChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next_value) => {
        if (next_value !== null) onValueChange(next_value);
      }}
    >
      <SelectTrigger
        aria-label="Filter recent chats by project"
        size="sm"
        className="max-w-32 rounded-xl bg-transparent px-1.5 text-[13px] leading-5 text-muted-foreground shadow-none hover:bg-sidebar-accent hover:shadow-none data-[size=sm]:h-6 data-[popup-open]:bg-sidebar-accent data-[popup-open]:shadow-none *:data-[slot=select-value]:block [&_svg]:size-3 [&_svg]:transition-transform data-[popup-open]:[&_svg]:rotate-180"
      >
        <SelectValue className="min-w-0 truncate" />
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        className="w-64 min-w-0 max-w-[calc(100vw-2rem)] rounded-2xl bg-popover p-1 shadow-lg ring-1 ring-border"
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="h-9 rounded-xl text-foreground [&>div:first-child]:min-w-0 [&>div:first-child]:shrink [&>div:first-child>span]:truncate"
          >
            <span className="truncate">{option.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function session_time(session: Session): number {
  return new Date(
    session.last_message_time ?? session.last_updated_time ?? session.created_time ?? 0,
  ).getTime();
}

function SidebarReadError({ message, on_retry }: { message: string; on_retry: () => void }) {
  return (
    <div role="alert" className="px-2 py-1 text-xs text-muted-foreground">
      {message}{' '}
      <button type="button" className="underline hover:text-foreground" onClick={on_retry}>
        Retry
      </button>
    </div>
  );
}

function NewProjectButton() {
  const [naming, set_naming] = useState(false);
  return (
    <>
      <Button
        aria-label="New project"
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={() => set_naming(true)}
      >
        <Plus className="size-3.5" />
      </Button>
      <NewProjectDialog open={naming} onOpenChange={set_naming} />
    </>
  );
}

function SidebarProjectRows({
  projects,
  workspace_name,
}: {
  projects: Project[];
  workspace_name: string | undefined;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  if (projects.length === 0) {
    return <p className="px-2 py-1 text-muted-foreground text-xs">No projects yet</p>;
  }
  return (
    <SidebarMenu>
      {projects.map((project) => {
        const href = `/projects/${project.project_id}`;
        const is_active = pathname.startsWith(href);
        return (
          <SidebarProjectLinkView
            key={project.project_id}
            project={project}
            workspace_name={workspace_name}
            is_active={is_active}
          />
        );
      })}
    </SidebarMenu>
  );
}

function SidebarRowsSkeleton() {
  return (
    <div className="space-y-1 px-2 py-1">
      {[0, 1, 2].map((index) => (
        <Skeleton className="h-7 rounded-2xl" key={index} />
      ))}
    </div>
  );
}

export function SidebarProjectsSection({ children }: { children: ReactNode }) {
  return (
    <SidebarGroup className="min-h-8 shrink md:group-data-[collapsed=true]/sidebar:hidden">
      {children}
    </SidebarGroup>
  );
}
export function SidebarRecentSection({ children }: { children: ReactNode }) {
  return (
    <SidebarGroup className="min-h-[124px] flex-1 md:group-data-[collapsed=true]/sidebar:hidden">
      {children}
    </SidebarGroup>
  );
}

export function SidebarProjectsHeading({
  projects_open,
  on_toggle,
  actions,
}: {
  projects_open: boolean;
  on_toggle: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-2">
      <button
        type="button"
        aria-expanded={projects_open}
        aria-controls="sidebar-project-shortcuts"
        aria-label={projects_open ? 'Collapse projects' : 'Expand projects'}
        onClick={on_toggle}
        className="flex items-center gap-1 text-[13px] leading-5 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {projects_open ? (
          <ChevronDown aria-hidden="true" className="size-3" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3" />
        )}
        Projects
      </button>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function SidebarRecentHeading({ filter }: { filter: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-2">
      <SidebarGroupLabel className="p-0 text-[13px] leading-5">Recent</SidebarGroupLabel>
      {filter}
    </div>
  );
}

export function SidebarProjectLinkView({
  project,
  workspace_name,
  is_active = false,
  on_select,
  disabled = false,
}: {
  project: Pick<Project, 'project_id' | 'project_name' | 'is_workspace_default'>;
  workspace_name: string | undefined;
  is_active?: boolean;
  on_select?: () => void;
  disabled?: boolean;
}) {
  const ProjectIcon = project.is_workspace_default ? Building2 : FolderOpen;
  const content = (
    <>
      <ProjectIcon aria-hidden="true" />
      <span className="truncate">
        {project.is_workspace_default ? workspace_room_name(workspace_name) : project.project_name}
      </span>
    </>
  );
  const attributes = {
    'aria-current': is_active ? ('page' as const) : undefined,
    'data-active': is_active ? 'true' : undefined,
    className: cn(sidebar_menu_item_class_name, 'rounded-2xl text-sm [&_svg]:size-3.5'),
  };
  return (
    <SidebarMenuItem>
      {on_select ? (
        <button type="button" {...attributes} disabled={disabled} onClick={on_select}>
          {content}
        </button>
      ) : (
        <AppNavLink href={`/projects/${project.project_id}`} {...attributes}>
          {content}
        </AppNavLink>
      )}
    </SidebarMenuItem>
  );
}
