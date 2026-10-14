import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import { useState } from 'react';
import { room_label } from '@/components/app/chat_room_label';
import { RoomConnectionRow } from '@/components/app/room_connection_row';
import { get_current_workspace, list_connections, list_projects } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

export function RoomConnectionsButton({ project_id }: { project_id: string }) {
  const [open, set_open] = useState(false);

  return (
    <>
      <Button
        aria-label="Connections in this room"
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() => set_open(true)}
      >
        <Plug className="size-4" />
      </Button>
      <RoomConnectionsDialog open={open} project_id={project_id} on_open_change={set_open} />
    </>
  );
}

function RoomConnectionsDialog({
  open,
  project_id,
  on_open_change,
}: {
  open: boolean;
  project_id: string;
  on_open_change: (open: boolean) => void;
}) {
  const connections_query = useQuery({
    queryKey: query_keys.connections(),
    queryFn: list_connections,
    enabled: open,
  });
  const rooms_query = useQuery({
    queryKey: query_keys.projects(''),
    queryFn: () => list_projects(),
    enabled: open,
  });
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const room_name = room_label(
    project_id,
    rooms_query.data ?? [],
    workspace_query.data?.workspace_name,
  );
  const connections = (connections_query.data ?? []).filter(
    (connection) => connection.connection_status === 'active',
  );

  return (
    <AlertDialog open={open} onOpenChange={on_open_change}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogTitle>Connections in {room_name}</AlertDialogTitle>
        <RoomConnectionList
          connections={connections}
          isPending={connections_query.isPending}
          project_id={project_id}
          room_name={room_name}
        />
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={() => on_open_change(false)}>
            Done
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RoomConnectionList({
  connections,
  isPending,
  project_id,
  room_name,
}: {
  connections: Connection[];
  isPending: boolean;
  project_id: string;
  room_name: string;
}) {
  if (isPending) return <Skeleton className="mt-4 h-28 w-full" />;
  if (connections.length === 0) {
    return (
      <p className="mt-3 text-muted-foreground text-sm">
        Nothing connected yet. Ask in the chat for the app you need.
      </p>
    );
  }

  return (
    <>
      <ul className="mt-4 divide-y rounded-xl border">
        {connections.map((connection) => (
          <RoomConnectionRow
            connection={connection}
            key={connection.connection_id}
            project_id={project_id}
            room_name={room_name}
          />
        ))}
      </ul>
      <p className="mt-3 text-muted-foreground text-xs">
        Access levels apply everywhere the connection is shared.
      </p>
    </>
  );
}
