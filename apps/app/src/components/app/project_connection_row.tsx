// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { Button } from '@coworker/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  audience_went_stale,
  audience_write_refusal,
  body_for_everyone,
  body_for_only_person,
  everyone_label,
  member_first_name,
  member_name,
  read_connection_audience,
  replacing,
} from '@/components/app/connection_audience';
import { use_viewer_may_edit_audience } from '@/components/app/connection_audience_editor';
import { OpenToEveryoneConfirm } from '@/components/app/open_to_everyone_confirm';
import { ConnectionNameCell, connection_name } from '@/components/app/room_connection_row';
import { read_project_removal } from '@/components/app/room_connection_state';
import { ApiError } from '@/lib/api/client';
import {
  get_current_workspace,
  list_workspace_members,
  type ResourceSharing,
  remove_resource_grantee,
  set_resource_sharing,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

export function ProjectConnectionRow({
  connection,
  project_id,
  room_name,
  sharing,
}: {
  connection: Connection;
  project_id: string;
  room_name: string;
  sharing: ResourceSharing;
}) {
  const [confirming_everyone, set_confirming_everyone] = useState(false);
  const workspace = useQuery({ queryKey: query_keys.workspace(), queryFn: get_current_workspace });
  const members = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const owner = members.data?.find((member) => member.user_id === connection.connected_by);
  const remove = use_removal_from_room({ connection, project_id });
  const viewer_may_edit = use_viewer_may_edit_audience(connection);
  const removal = read_project_removal(sharing, project_id, connection.connected_by);
  const shared_with_everyone = read_connection_audience(sharing).kind === 'everyone';

  function click_remove() {
    if (removal.kind === 'needs_everyone_confirm') return set_confirming_everyone(true);
    if (removal.kind === 'make_owner_only') {
      return remove.mutate({
        body: replacing(sharing, body_for_only_person(removal.owner_user_id)),
        message: `Removed from ${room_name}. Now only ${member_name(owner)}.`,
      });
    }
    if (removal.kind === 'untick') {
      remove.mutate({ message: `${connection_name(connection)} removed from ${room_name}.` });
    }
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <ConnectionNameCell connection={connection} />
      <span className="shrink-0 text-muted-foreground text-xs">
        {shared_with_everyone ? everyone_label(workspace.data?.workspace_name) : 'In this project'}
      </span>
      {removal.kind === 'nothing' || !viewer_may_edit ? null : (
        <Button
          disabled={remove.isPending}
          size="sm"
          type="button"
          variant="ghost"
          onClick={click_remove}
        >
          {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Remove
        </Button>
      )}
      <OpenToEveryoneConfirm
        open={confirming_everyone}
        workspace_name={workspace.data?.workspace_name}
        onConfirm={() =>
          remove.mutate({
            body: replacing(sharing, body_for_everyone()),
            message: `Removed from ${room_name}. Now everyone.`,
          })
        }
        onOpenChange={set_confirming_everyone}
      />
    </li>
  );
}

type Removal = {
  body?: Parameters<typeof set_resource_sharing>[2];
  message: string;
};

function use_removal_from_room({
  connection,
  project_id,
}: {
  connection: Connection;
  project_id: string;
}) {
  const query_client = useQueryClient();
  const members = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const refresh = () =>
    query_client.invalidateQueries({
      queryKey: query_keys.sharing('connection', connection.connection_id),
    });

  return useMutation({
    mutationFn: (removal: Removal) =>
      removal.body
        ? set_resource_sharing('connection', connection.connection_id, removal.body)
        : remove_resource_grantee('connection', connection.connection_id, 'project', project_id),
    onSuccess: (_result, removal) => {
      refresh();
      toast.success(removal.message);
    },
    onError: (error: Error) => {
      const owner = members.data?.find((member) => member.user_id === connection.connected_by);
      const status = error instanceof ApiError ? error.status : undefined;
      if (audience_went_stale(status)) refresh();
      toast.error(audience_write_refusal(status, member_first_name(owner)) ?? error.message);
    },
  });
}
