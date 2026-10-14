import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ProjectConnectionRow } from '@/components/app/project_connection_row';
import { ProjectSection } from '@/components/app/project_section';
import { RoomConnectionRow } from '@/components/app/room_connection_row';
import { read_room_connection_state } from '@/components/app/room_connection_state';
import { get_resource_sharing, list_connections, type ResourceSharing } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

type Row = { connection: Connection; sharing: ResourceSharing };

export function ProjectConnectionsSection({
  project_id,
  room_name,
}: {
  project_id: string;
  room_name: string;
}) {
  const connections_query = useQuery({
    queryKey: query_keys.connections(),
    queryFn: list_connections,
  });
  const connections = (connections_query.data ?? []).filter(
    (connection) => connection.connection_status === 'active',
  );
  const sharings = useQueries({
    queries: connections.map((connection) => ({
      queryKey: query_keys.sharing('connection', connection.connection_id),
      queryFn: () => get_resource_sharing('connection', connection.connection_id),
    })),
  });
  const rows = connections.flatMap((connection, index) => {
    const sharing = sharings[index]?.data;
    return sharing ? [{ connection, sharing }] : [];
  });
  const is_here = (row: Row) =>
    read_room_connection_state(row.sharing, project_id, row.connection.connected_by) ===
    'available';

  return (
    <ProjectSection title="Connections" description="What Alfera can use here.">
      {connections_query.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : connections.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing connected yet. <ConnectAnApp />
        </p>
      ) : (
        <div className="space-y-3">
          <MemberList project_id={project_id} rows={rows.filter(is_here)} room_name={room_name} />
          <AddList
            project_id={project_id}
            rows={rows.filter((row) => !is_here(row))}
            room_name={room_name}
          />
        </div>
      )}
    </ProjectSection>
  );
}

function MemberList({
  project_id,
  rows,
  room_name,
}: {
  project_id: string;
  rows: Row[];
  room_name: string;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No connections in this project yet.</p>;
  }
  return (
    <ul className="divide-y rounded-xl border">
      {rows.map((row) => (
        <ProjectConnectionRow
          connection={row.connection}
          key={row.connection.connection_id}
          project_id={project_id}
          room_name={room_name}
          sharing={row.sharing}
        />
      ))}
    </ul>
  );
}

function AddList({
  project_id,
  rows,
  room_name,
}: {
  project_id: string;
  rows: Row[];
  room_name: string;
}) {
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">
        Add a connection
      </summary>
      {rows.length === 0 ? (
        <p className="mt-2 text-muted-foreground text-xs">
          Everything you have connected is already here. <ConnectAnApp />
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y rounded-xl border">
            {rows.map((row) => (
              <RoomConnectionRow
                connection={row.connection}
                key={row.connection.connection_id}
                project_id={project_id}
                room_name={room_name}
              />
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground text-xs">
            <ConnectAnApp />
          </p>
        </>
      )}
    </details>
  );
}

function ConnectAnApp() {
  return (
    <Link className="underline hover:text-foreground" to="/integrations">
      Connect an app
    </Link>
  );
}
