import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { Label } from '@coworker/ui/components/label';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { member_name } from '@/components/app/connection_audience';
import { OpenToEveryoneConfirm } from '@/components/app/open_to_everyone_confirm';
import { InitialsAvatar } from '@/components/app/team_initials_avatar';
import { read_people_with_access } from '@/components/connections/connection_audience_field';
import { use_connection_people } from '@/components/connections/use_connection_people';
import {
  get_current_workspace,
  list_workspace_members,
  type ResourceSharing,
  type WorkspaceMember,
} from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

export function ConnectionPeople({
  connection_id,
  sharing,
}: {
  connection_id: string;
  sharing: ResourceSharing;
}) {
  const people = use_connection_people(connection_id, sharing);
  const members_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const workspace_members = members_query.data ?? [];
  const named_ids = read_people_with_access(sharing).map((person) => person.user_id);
  if (named_ids.length === 0) return null;

  const not_named_yet = workspace_members.filter((member) => !named_ids.includes(member.user_id));
  return (
    <div className="grid gap-2">
      <Label>People with access</Label>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {named_ids.map((user_id) => (
          <PersonRow
            is_you={user_id === workspace_query.data?.viewer_user_id}
            key={user_id}
            member={workspace_members.find((member) => member.user_id === user_id)}
            onRemove={() => people.add_or_remove(user_id)}
          />
        ))}
        {not_named_yet.length > 0 ? (
          <li>
            <AddPerson members={not_named_yet} onAdd={people.add_or_remove} />
          </li>
        ) : null}
      </ul>
      <OpenToEveryoneConfirm
        open={people.asking_to_open_to_everyone}
        workspace_name={workspace_query.data?.workspace_name}
        onConfirm={people.open_to_everyone}
        onOpenChange={people.set_asking_to_open_to_everyone}
      />
    </div>
  );
}

function PersonRow({
  is_you,
  member,
  onRemove,
}: {
  is_you: boolean;
  member: WorkspaceMember | undefined;
  onRemove: () => void;
}) {
  const name = member_name(member);
  return (
    <li className="flex items-center gap-3 py-2 pr-2 pl-3">
      <InitialsAvatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">
          {name}
          {is_you ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
        </span>
        {member?.email && member.email !== name ? (
          <span className="block truncate text-muted-foreground text-xs">{member.email}</span>
        ) : null}
      </span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
        onClick={onRemove}
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground active:scale-[0.96]"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

function AddPerson({
  members,
  onAdd,
}: {
  members: readonly WorkspaceMember[];
  onAdd: (user_id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex h-12 w-full items-center gap-3 rounded-b-2xl pr-2 pl-3 text-left text-muted-foreground text-sm transition-colors duration-150 hover:bg-hover hover:text-foreground"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border border-dashed">
              <Plus className="size-4" aria-hidden="true" />
            </span>
            Add a person
          </button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
        {members.map((member) => (
          <DropdownMenuItem key={member.user_id} onClick={() => onAdd(member.user_id)}>
            <InitialsAvatar name={member_name(member)} />
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">
                {member_name(member)}
              </span>
              {member.email !== member_name(member) ? (
                <span className="block truncate text-muted-foreground text-xs">{member.email}</span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
