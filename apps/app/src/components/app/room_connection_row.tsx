// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConnectionAccessSelect } from '@/components/app/connection_access_select';
import {
  audience_went_stale,
  audience_write_refusal,
  body_for_projects,
  member_first_name,
  replacing,
} from '@/components/app/connection_audience';
import { use_viewer_may_edit_audience } from '@/components/app/connection_audience_editor';
import {
  type RoomConnectionState,
  read_room_connection_state,
} from '@/components/app/room_connection_state';
import { ApiError } from '@/lib/api/client';
import {
  add_resource_grantee,
  get_resource_sharing,
  list_workspace_members,
  type ResourceSharing,
  set_resource_sharing,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

export function RoomConnectionRow({
  connection,
  project_id,
  room_name,
}: {
  connection: Connection;
  project_id: string;
  room_name: string;
}) {
  const name = connection_name(connection);
  const sharing_query = useQuery({
    queryKey: query_keys.sharing('connection', connection.connection_id),
    queryFn: () => get_resource_sharing('connection', connection.connection_id),
  });
  const lend = use_lending_to_room({ connection, name, project_id, room_name });
  const viewer_may_edit = use_viewer_may_edit_audience(connection);
  const sharing = sharing_query.data ?? null;
  const state = sharing
    ? read_room_connection_state(sharing, project_id, connection.connected_by)
    : null;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <ConnectionNameCell connection={connection} />
      {state === null || sharing === null ? (
        <Skeleton className="h-7 w-44" />
      ) : (
        <RoomConnectionAction
          connection_id={connection.connection_id}
          isLending={lend.isPending}
          mayEdit={viewer_may_edit}
          name={name}
          state={state}
          onAdd={() => lend.mutate({ state, sharing })}
        />
      )}
    </li>
  );
}

function RoomConnectionAction({
  connection_id,
  isLending,
  mayEdit,
  name,
  state,
  onAdd,
}: {
  connection_id: string;
  isLending: boolean;
  mayEdit: boolean;
  name: string;
  state: RoomConnectionState;
  onAdd: () => void;
}) {
  if (state === 'private') {
    return <span className="shrink-0 text-muted-foreground text-xs">Private</span>;
  }
  if (state !== 'available') {
    if (!mayEdit) {
      return <span className="shrink-0 text-muted-foreground text-xs">Not in this project</span>;
    }
    return (
      <Button disabled={isLending} size="sm" type="button" variant="outline" onClick={onAdd}>
        {isLending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Add
      </Button>
    );
  }
  return (
    <>
      <span className="shrink-0 text-muted-foreground text-xs">Available here</span>
      {mayEdit ? <ConnectionAccessSelect connection_id={connection_id} label={name} /> : null}
    </>
  );
}

function use_lending_to_room({
  connection,
  name,
  project_id,
  room_name,
}: {
  connection: Connection;
  name: string;
  project_id: string;
  room_name: string;
}) {
  const query_client = useQueryClient();
  const members_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });

  const refresh = () =>
    query_client.invalidateQueries({
      queryKey: query_keys.sharing('connection', connection.connection_id),
    });

  return useMutation({
    mutationFn: ({ state, sharing }: { state: RoomConnectionState; sharing: ResourceSharing }) =>
      state === 'convert'
        ? set_resource_sharing(
            'connection',
            connection.connection_id,
            replacing(sharing, body_for_projects([project_id])),
          )
        : add_resource_grantee('connection', connection.connection_id, {
            project: project_id,
            can: 'use',
          }),
    onSuccess: () => {
      refresh();
      toast.success(`${name} added to ${room_name}.`);
    },
    onError: (error: Error) => {
      const owner = members_query.data?.find(
        (member) => member.user_id === connection.connected_by,
      );
      const status = error instanceof ApiError ? error.status : undefined;
      if (audience_went_stale(status)) refresh();
      toast.error(audience_write_refusal(status, member_first_name(owner)) ?? error.message);
    },
  });
}

export function ConnectionNameCell({ connection }: { connection: Connection }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm">{connection_name(connection)}</span>
      {connection.external_account_name ? (
        <span className="block truncate text-muted-foreground text-xs">
          {connection.external_account_name}
        </span>
      ) : null}
    </span>
  );
}

export function connection_name(connection: Connection): string {
  return connection.app?.app_display_name ?? connection.connection_name ?? 'Connection';
}
