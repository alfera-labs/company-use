// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { useQuery } from '@tanstack/react-query';
import { build_team_slack_status } from '@/components/app/team_slack_status';
import type { WorkspaceInvitation, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import { list_workspace_slack_people } from '@/lib/api/workspace_slack_people';

export function use_team_slack_status(
  members: WorkspaceMember[] | undefined,
  invitations: WorkspaceInvitation[] | undefined,
) {
  const slack_people_query = useQuery({
    queryKey: query_keys.workspace_slack_people(),
    queryFn: list_workspace_slack_people,
  });
  return build_team_slack_status({ members, invitations, slack_people: slack_people_query.data });
}
