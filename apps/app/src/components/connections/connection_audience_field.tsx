import { Label } from '@coworker/ui/components/label';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { audience_label, read_connection_audience } from '@/components/app/connection_audience';
import { ConnectionAudienceForViewer } from '@/components/app/connection_audience_for_viewer';
import {
  get_current_workspace,
  get_resource_sharing,
  list_projects,
  list_workspace_members,
  type ResourceSharing,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';
import type { ConnectionAccessMember } from '@/lib/connection_access';

export function connection_sharing_query(connection_id: string) {
  return {
    queryKey: query_keys.sharing('connection', connection_id),
    queryFn: () => get_resource_sharing('connection', connection_id),
  };
}

export function ConnectionAudienceField({ connection }: { connection: Connection }) {
  const sharing = useQuery(connection_sharing_query(connection.connection_id));
  return (
    <div className="grid gap-1.5">
      <Label>Who can use it</Label>
      <div className="flex">
        {sharing.data ? (
          <ConnectionAudienceForViewer
            connection_id={connection.connection_id}
            owner_user_id={connection.connected_by}
            sharing={sharing.data}
          />
        ) : (
          <Skeleton className="h-6 w-24" />
        )}
      </div>
    </div>
  );
}

export function ConnectionAudienceReadback({ connection }: { connection: Connection }) {
  const sharing = useQuery(connection_sharing_query(connection.connection_id));
  const rooms = useQuery({ queryKey: query_keys.projects(''), queryFn: () => list_projects() });
  const members = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const workspace = useQuery({ queryKey: query_keys.workspace(), queryFn: get_current_workspace });
  if (!sharing.data) return <Skeleton className="h-4 w-20" />;

  const viewer_user_id = workspace.data?.viewer_user_id;
  return (
    <>
      {audience_label(read_connection_audience(sharing.data), rooms.data ?? [], {
        members: members.data ?? [],
        ...(viewer_user_id ? { viewer_user_id } : {}),
      })}
    </>
  );
}

export function read_people_with_access(sharing: ResourceSharing): ConnectionAccessMember[] {
  return sharing.shared_with.flatMap((entry) =>
    'person' in entry ? [{ user_id: entry.person, can_edit_tools: entry.can === 'manage' }] : [],
  );
}
