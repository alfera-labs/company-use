import { Badge } from '@coworker/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  audience_label,
  audience_went_stale,
  audience_write_refusal,
  body_for_everyone,
  body_for_only_person,
  body_for_projects,
  everyone_label,
  member_first_name,
  member_name,
  read_connection_audience,
  read_project_tick,
  replacing,
} from '@/components/app/connection_audience';
import {
  AudienceChoice,
  AudienceProjectChoices,
  OwnChatsNote,
} from '@/components/app/connection_audience_choice';
import { AudiencePeopleSubmenu } from '@/components/app/connection_audience_people_menu';
import { OpenToEveryoneConfirm } from '@/components/app/open_to_everyone_confirm';
import { read_project_removal } from '@/components/app/room_connection_state';
import { ApiError } from '@/lib/api/client';
import {
  add_resource_grantee,
  get_current_workspace,
  list_projects,
  list_workspace_members,
  type ResourceSharing,
  remove_resource_grantee,
  set_resource_sharing,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

export function ConnectionAudienceMenu({
  connection_id,
  current_project_id,
  owner_user_id,
  sharing,
}: {
  connection_id: string;
  current_project_id?: string;
  owner_user_id?: string | null;
  sharing: ResourceSharing;
}) {
  const query_client = useQueryClient();
  const [confirming_everyone, set_confirming_everyone] = useState(false);
  const rooms_query = useQuery({
    queryKey: query_keys.projects(''),
    queryFn: () => list_projects(),
  });
  const members_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const members = members_query.data ?? [];
  const viewer = members.find((member) => member.user_id === workspace_query.data?.viewer_user_id);
  const viewer_user_id = viewer?.user_id;
  const workspace_name = workspace_query.data?.workspace_name;

  const refresh = () =>
    query_client.invalidateQueries({ queryKey: query_keys.sharing('connection', connection_id) });
  const on_error = (error: Error) => {
    const owner = members.find((member) => member.user_id === owner_user_id);
    const status = error instanceof ApiError ? error.status : undefined;
    if (audience_went_stale(status)) refresh();
    toast.error(audience_write_refusal(status, member_first_name(owner)) ?? error.message);
  };

  const save = useMutation({
    mutationFn: (body: Parameters<typeof set_resource_sharing>[2]) =>
      set_resource_sharing('connection', connection_id, body),
    onSuccess: refresh,
    onError: on_error,
  });
  const tick = useMutation({
    mutationFn: (input: { project_id: string; add: boolean }) =>
      input.add
        ? add_resource_grantee('connection', connection_id, {
            project: input.project_id,
            can: 'use',
          })
        : remove_resource_grantee('connection', connection_id, 'project', input.project_id),
    onSuccess: refresh,
    onError: on_error,
  });

  const rooms = (rooms_query.data ?? []).filter(
    (room) => room.personal_for_user_id === null && !room.is_workspace_default,
  );
  const audience = read_connection_audience(sharing);
  const is_saving = save.isPending || tick.isPending;

  function pick_project(project_id: string) {
    const decision = read_project_tick(sharing, project_id, owner_user_id);
    if (decision.allowed === 'no') return toast.error(decision.reason);
    if (decision.allowed === 'open_to_everyone') {
      const removal = read_project_removal(sharing, project_id, owner_user_id);
      if (removal.kind === 'make_owner_only') {
        return save.mutate(replacing(sharing, body_for_only_person(removal.owner_user_id)));
      }
      return set_confirming_everyone(true);
    }
    if (decision.allowed === 'convert_from_only_person') {
      return save.mutate(replacing(sharing, body_for_projects([project_id])));
    }
    return tick.mutate({ project_id, add: decision.allowed === 'add' });
  }

  const ask_to_open_to_everyone = () => set_confirming_everyone(audience.kind !== 'everyone');
  const viewer_owns_it = Boolean(viewer_user_id) && viewer_user_id === owner_user_id;

  return (
    <span className="flex shrink-0 items-center gap-2">
      {is_saving ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={is_saving}
          render={
            <ConnectionAudienceTrigger
              label={audience_label(audience, rooms_query.data ?? [], {
                members,
                ...(viewer_user_id ? { viewer_user_id } : {}),
                ...(current_project_id ? { current_project_id } : {}),
              })}
              variant={audience.kind === 'everyone' ? 'secondary' : 'brand'}
            />
          }
        />
        <DropdownMenuContent align="end" className="min-w-56">
          <AudienceChoice
            checked={audience.kind === 'everyone'}
            label={everyone_label(workspace_name)}
            onPick={ask_to_open_to_everyone}
          />
          {viewer_user_id ? (
            <AudienceChoice
              checked={audience.kind === 'only_person' && audience.person_id === viewer_user_id}
              label={`Only ${member_name(viewer)} (you)`}
              onPick={() => save.mutate(replacing(sharing, body_for_only_person(viewer_user_id)))}
            />
          ) : null}
          <AudienceProjectChoices
            current_project_id={current_project_id}
            rooms={rooms}
            sharing={sharing}
            onPick={pick_project}
          />
          <AudiencePeopleSubmenu
            members={members}
            sharing={sharing}
            onOpenToEveryone={ask_to_open_to_everyone}
            onSave={save.mutate}
          />
          <OwnChatsNote shown={viewer_owns_it && audience.kind !== 'everyone'} />
        </DropdownMenuContent>
      </DropdownMenu>
      <OpenToEveryoneConfirm
        open={confirming_everyone}
        workspace_name={workspace_name}
        onConfirm={() => save.mutate(replacing(sharing, body_for_everyone()))}
        onOpenChange={set_confirming_everyone}
      />
    </span>
  );
}

export function ConnectionAudienceTrigger({
  label,
  variant = 'secondary',
  ...button_props
}: {
  label: string;
  variant?: 'secondary' | 'brand';
} & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button aria-label="Who can use this connection" type="button" {...button_props}>
      <Badge variant={variant}>
        {label}
        <ChevronDown aria-hidden="true" />
      </Badge>
    </button>
  );
}
