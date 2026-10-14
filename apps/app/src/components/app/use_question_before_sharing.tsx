import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { readers_of_room } from '@/components/app/chat_room_label';
import { SidebarChatShareDialog } from '@/components/app/sidebar_chat_share_dialog';
import { use_team_viewer_role } from '@/components/app/use_team_mode';
import { get_current_workspace } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

export type MoveChat = (project: Project, shares_it: boolean) => void;

/**
 * Where several people sign in to one install, a chat is private until it is moved into a
 * project other people read. That move asks first and says who will read the chat. A move
 * into a person's own room shares nothing and goes at once, and so does every move in an
 * install of any other mode.
 */
export function useQuestionBeforeSharing(chat_title: string, on_move: MoveChat | undefined) {
  const asks_first = use_team_viewer_role() !== null;
  const [target, set_target] = useState<Project | null>(null);
  const [is_asking, set_is_asking] = useState(false);
  const workspace_name = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
    enabled: asks_first,
  }).data?.workspace_name;
  const readers = target ? readers_of_room(target, workspace_name) : null;
  function move_or_ask(project: Project) {
    if (!asks_first || !readers_of_room(project)) return on_move?.(project, false);
    set_target(project);
    set_is_asking(true);
  }
  const share_dialog = readers ? (
    <SidebarChatShareDialog
      chat_title={chat_title}
      readers={readers}
      open={is_asking}
      on_open_change={set_is_asking}
      on_share={() => (target ? on_move?.(target, true) : undefined)}
    />
  ) : null;
  return { move_or_ask: on_move ? move_or_ask : undefined, share_dialog };
}
