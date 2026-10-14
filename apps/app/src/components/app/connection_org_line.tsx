import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQueries, useQuery } from '@tanstack/react-query';
import { audience_key, member_name } from '@/components/app/connection_audience';
import { ConnectionAudienceForViewer } from '@/components/app/connection_audience_for_viewer';
import { get_resource_sharing, list_workspace_members } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

function sharing_query(connection_id: string) {
  return {
    queryKey: query_keys.sharing('connection', connection_id),
    queryFn: () => get_resource_sharing('connection', connection_id),
  };
}

export function ConnectionOrgLine({ connection }: { connection: Connection }) {
  const sharing = useQuery(sharing_query(connection.connection_id));
  const members = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const owner = members.data?.find((member) => member.user_id === connection.connected_by);

  return (
    <div className="pointer-events-none relative z-10 flex items-center justify-end gap-2">
      {owner ? (
        <span className="hidden max-w-40 truncate text-muted-foreground text-xs md:inline">
          Connected by {member_name(owner)}
        </span>
      ) : null}
      {sharing.data ? (
        <span className="pointer-events-auto">
          <ConnectionAudienceForViewer
            connection_id={connection.connection_id}
            owner_user_id={connection.connected_by}
            sharing={sharing.data}
          />
        </span>
      ) : (
        <Skeleton className="h-6 w-24" />
      )}
    </div>
  );
}

export function SiblingAudienceNote({
  connection,
  connections,
}: {
  connection: Connection;
  connections: readonly Connection[];
}) {
  const earlier = earlier_connections_for_the_same_app(connections, connection);
  const sharings = useQueries({
    queries: [connection, ...earlier].map((row) => sharing_query(row.connection_id)),
  });
  const keys = sharings.map((result) => (result.data ? audience_key(result.data) : null));
  const mine = keys[0];
  const disagrees = mine !== null && keys.slice(1).some((key) => key !== null && key !== mine);
  if (!disagrees) return null;

  const app_name = connection.app?.app_display_name ?? connection.connection_name ?? 'app';
  return (
    <p className="px-2 pb-2 text-muted-foreground text-xs">
      Another {app_name} connection has a different audience.
    </p>
  );
}

function earlier_connections_for_the_same_app(
  connections: readonly Connection[],
  connection: Connection,
): Connection[] {
  const position = connections.findIndex((row) => row.connection_id === connection.connection_id);
  return connections.filter((row, index) => index < position && row.app_id === connection.app_id);
}
