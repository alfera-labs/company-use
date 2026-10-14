import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { cn } from '@coworker/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { room_label } from '@/components/app/chat_room_label';
import { SidebarChatDeleteDialog } from '@/components/app/sidebar_chat_delete_dialog';
import {
  type MoveChat,
  useQuestionBeforeSharing,
} from '@/components/app/use_question_before_sharing';
import { get_current_workspace, list_projects } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

const row_action_class_name =
  'absolute top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring aria-expanded:opacity-100 data-[popup-open]:opacity-100 max-md:opacity-100 md:group-hover/chat-row:opacity-100 md:group-focus-within/chat-row:opacity-100';

type ChatRowMenuProps = {
  chat_title: string;
  project_id: string | null;
  on_rename: () => void;
  on_move?: ((project: Project) => void) | undefined;
  on_ask_to_delete?: (() => void) | undefined;
};

/**
 * The actions at the right edge of a chat row: a menu to rename, move or delete it, and an X
 * that deletes. Both delete paths ask first. A narrow screen shows no hover, so the X is
 * hidden there and the menu holds Delete. A row with no `on_move` or no `on_delete` offers
 * no move or no delete. A reader who may change nothing gets no actions: see the row.
 */
export function SidebarChatActions({
  on_delete,
  on_move,
  ...menu
}: Omit<ChatRowMenuProps, 'on_ask_to_delete' | 'on_move'> & {
  on_move?: MoveChat | undefined;
  on_delete?: (() => void) | undefined;
}) {
  const [is_asking_to_delete, set_is_asking_to_delete] = useState(false);
  const sharing = useQuestionBeforeSharing(menu.chat_title, on_move);
  const row_menu = { ...menu, on_move: sharing.move_or_ask };
  if (!on_delete) {
    return (
      <>
        <ChatRowMenu {...row_menu} className="right-1.5" />
        {sharing.share_dialog}
      </>
    );
  }
  return (
    <>
      <ChatRowMenu
        {...row_menu}
        className="right-1.5 md:right-7"
        on_ask_to_delete={() => set_is_asking_to_delete(true)}
      />
      <button
        aria-label={`Delete chat ${menu.chat_title}`}
        className={cn(row_action_class_name, 'right-1.5 max-md:hidden')}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          set_is_asking_to_delete(true);
        }}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
      <SidebarChatDeleteDialog
        chat_title={menu.chat_title}
        open={is_asking_to_delete}
        on_open_change={set_is_asking_to_delete}
        on_delete={on_delete}
      />
      {sharing.share_dialog}
    </>
  );
}

function ChatRowMenu({
  chat_title,
  project_id,
  on_rename,
  on_move,
  on_ask_to_delete,
  className,
}: ChatRowMenuProps & { className: string }) {
  const [menu_is_open, set_menu_is_open] = useState(false);
  const focus_goes_to_the_name_field = useRef(false);
  const projects_query = useQuery({
    queryKey: query_keys.projects(''),
    queryFn: () => list_projects(),
    enabled: menu_is_open && Boolean(on_move),
  });
  const other_projects = projects_to_move_into(projects_query.data ?? [], project_id);
  function focus_after_the_menu_closes() {
    const stays_on_the_trigger = !focus_goes_to_the_name_field.current;
    focus_goes_to_the_name_field.current = false;
    return stays_on_the_trigger;
  }
  function start_renaming() {
    focus_goes_to_the_name_field.current = true;
    on_rename();
  }
  return (
    <DropdownMenu open={menu_is_open} onOpenChange={set_menu_is_open}>
      <DropdownMenuTrigger
        aria-label={`Rename or move chat ${chat_title}`}
        className={cn(row_action_class_name, className)}
      >
        <MoreHorizontal aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-48"
        finalFocus={focus_after_the_menu_closes}
      >
        <DropdownMenuItem onClick={start_renaming}>Rename</DropdownMenuItem>
        <ProjectsToMoveInto
          projects={other_projects}
          is_loading={projects_query.isPending}
          on_move={on_move}
        />
        {on_ask_to_delete ? <DeleteChatItem on_ask_to_delete={on_ask_to_delete} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteChatItem({ on_ask_to_delete }: { on_ask_to_delete: () => void }) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={on_ask_to_delete}>
        Delete
      </DropdownMenuItem>
    </>
  );
}

function ProjectsToMoveInto({
  projects,
  is_loading,
  on_move,
}: {
  projects: readonly Project[];
  is_loading: boolean;
  on_move: ((project: Project) => void) | undefined;
}) {
  const workspace_name = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
    enabled: Boolean(on_move),
  }).data?.workspace_name;
  if (!on_move) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>
        {projects.length > 0 || is_loading ? 'Move to project' : 'No other project to move to'}
      </DropdownMenuLabel>
      {projects.map((project) => (
        <DropdownMenuItem key={project.project_id} onClick={() => on_move(project)}>
          {room_label(project.project_id, [project], workspace_name)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function projects_to_move_into(
  projects: readonly Project[],
  current_project_id: string | null,
) {
  return projects.filter((project) =>
    current_project_id ? project.project_id !== current_project_id : !project.is_workspace_default,
  );
}
