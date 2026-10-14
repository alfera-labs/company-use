import { is_workspace_administrator_role } from '@coworker/shared';
import { Badge } from '@coworker/ui/components/badge';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import {
  audience_label,
  audience_write_refusal,
  member_first_name,
  read_connection_audience,
} from '@/components/app/connection_audience';
import { ConnectionAudienceMenu } from '@/components/app/connection_audience_menu';
import { get_current_workspace, list_projects, list_workspace_members } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

type AudienceProps = ComponentProps<typeof ConnectionAudienceMenu>;

/**
 * Who can use a connection: the menu that changes it for the person who made the connection
 * and for an owner or an admin, and the same words with nothing to press for anyone else. The
 * API refuses a change by anyone else, so a menu there would only lead to a refusal.
 */
export function ConnectionAudienceForViewer(props: AudienceProps) {
  const members =
    useQuery({ queryKey: query_keys.workspace_members(), queryFn: list_workspace_members }).data ??
    [];
  const viewer_user_id = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  }).data?.viewer_user_id;
  const viewer = members.find((member) => member.user_id === viewer_user_id);
  const may_change_it =
    !viewer ||
    viewer.user_id === props.owner_user_id ||
    is_workspace_administrator_role(viewer.member_role);
  if (may_change_it) return <ConnectionAudienceMenu {...props} />;
  const owner = members.find((member) => member.user_id === props.owner_user_id);
  return <AudienceWords {...props} owner_first_name={member_first_name(owner)} />;
}

function AudienceWords(props: AudienceProps & { owner_first_name: string | undefined }) {
  const rooms = useQuery({ queryKey: query_keys.projects(''), queryFn: () => list_projects() });
  const members = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const audience = read_connection_audience(props.sharing);
  return (
    <Badge
      variant={audience.kind === 'everyone' ? 'secondary' : 'brand'}
      title={audience_write_refusal(403, props.owner_first_name) ?? undefined}
    >
      {audience_label(audience, rooms.data ?? [], {
        members: members.data ?? [],
        ...(props.current_project_id ? { current_project_id: props.current_project_id } : {}),
      })}
    </Badge>
  );
}
