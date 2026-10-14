import { Button } from '@coworker/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Building2, FolderClosed, Lock, type LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { AppNavLink } from '@/components/app/app_nav_link';
import { room_label } from '@/components/app/chat_room_label';
import { chat_title } from '@/components/app/chat_title';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { RoomConnectionsButton } from '@/components/app/room_connections_dialog';
import type { Session } from '@/lib/api';
import { get_current_workspace, get_project, list_projects } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

type ChatHeaderProps = { selectedSession?: Session; has_address?: boolean };

function useChatRoom(selectedSession: Session | undefined) {
  const projects_query = useQuery({
    queryKey: query_keys.projects(''),
    queryFn: () => list_projects(),
  });
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const project_id = selectedSession?.project_id;
  const listed_project = projects_query.data?.find((project) =>
    project_id ? project.project_id === project_id : project.is_workspace_default,
  );
  const project_query = useQuery({
    queryKey: query_keys.project(project_id),
    queryFn: () => get_project(project_id ?? ''),
    enabled: Boolean(project_id && !listed_project),
  });
  const project = listed_project ?? project_query.data;
  const project_icon = project?.personal_for_user_id
    ? Lock
    : project?.is_workspace_default || !project_id
      ? Building2
      : FolderClosed;
  const breadcrumb_project_id = project_id ?? project?.project_id ?? null;
  const project_name = room_label(
    breadcrumb_project_id,
    project ? [project] : [],
    workspace_query.data?.workspace_name,
  );
  return { project, project_icon, breadcrumb_project_id, project_name };
}

/**
 * The header of a chat. A chat that is opened by its address has no title until the chat is
 * read: "New chat" is the name of a chat with no address yet, and not of a chat that loads.
 */
export const ChatHeader = memo(function ChatHeader(props: ChatHeaderProps) {
  const { selectedSession } = props;
  const files_panel_open = useChatUiStore((state) => state.files_panel_open);
  const set_files_panel_open = useChatUiStore((state) => state.set_files_panel_open);
  const { project, project_icon, breadcrumb_project_id, project_name } =
    useChatRoom(selectedSession);

  return (
    <ChatHeaderView
      project_id={selectedSession ? breadcrumb_project_id : null}
      project_name={selectedSession ? project_name : null}
      project_icon={project_icon}
      chat_title={props.has_address && !selectedSession ? '' : chat_title(selectedSession)}
      on_toggle_files={() => set_files_panel_open(!files_panel_open)}
      connection_control={
        selectedSession?.project_id &&
        project &&
        !project.personal_for_user_id &&
        !project.is_workspace_default ? (
          <RoomConnectionsButton project_id={selectedSession.project_id} />
        ) : null
      }
    />
  );
});

export function ChatHeaderView({
  on_toggle_files,
  connection_control,
  ...breadcrumb
}: React.ComponentProps<typeof ChatBreadcrumb> & {
  on_toggle_files: () => void;
  connection_control?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-4">
      <ChatBreadcrumb {...breadcrumb} />
      {connection_control}
      <Button size="sm" type="button" variant="ghost" onClick={on_toggle_files}>
        <FolderClosed aria-hidden="true" className="size-4" />
        Files
      </Button>
    </header>
  );
}

function ChatBreadcrumb({
  project_id,
  project_name,
  project_icon: ProjectIcon,
  chat_title,
}: {
  project_id: string | null;
  project_name: string | null;
  project_icon: LucideIcon;
  chat_title: string;
}) {
  const project_content = (
    <>
      <ProjectIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{project_name}</span>
    </>
  );
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1 text-sm">
      <ol className="flex min-w-0 items-center gap-2">
        {project_name ? (
          <>
            <li className="min-w-0 max-w-[45%]">
              {project_id ? (
                <AppNavLink
                  href={`/projects/${project_id}`}
                  title={project_name}
                  className="flex min-w-0 items-center gap-2 rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {project_content}
                </AppNavLink>
              ) : (
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  {project_content}
                </span>
              )}
            </li>
            <li aria-hidden="true" className="shrink-0 text-muted-foreground/50">
              /
            </li>
          </>
        ) : null}
        <li className="min-w-0 flex-1 truncate font-medium" title={chat_title}>
          <span aria-current="page">{chat_title}</span>
        </li>
      </ol>
    </nav>
  );
}
