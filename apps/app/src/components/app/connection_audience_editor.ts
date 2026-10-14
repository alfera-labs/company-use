// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { is_workspace_administrator_role } from '@coworker/shared';
import { useQuery } from '@tanstack/react-query';
import { get_current_workspace, list_workspace_members } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

export function use_viewer_may_edit_audience(connection: Connection): boolean {
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const members_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const viewer_user_id = workspace_query.data?.viewer_user_id;
  const viewer = (members_query.data ?? []).find((member) => member.user_id === viewer_user_id);
  if (!viewer) return false;
  return (
    viewer.user_id === connection.connected_by ||
    is_workspace_administrator_role(viewer.member_role)
  );
}
