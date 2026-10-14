import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Checkbox } from '@coworker/ui/components/checkbox';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { team_member_name } from '@/components/app/team_mode_words';
import {
  list_team_member_connections,
  type MemberConnection,
  type TeamMember,
  team_member_connections_query_key,
} from '@/lib/api/team_mode';

/**
 * Asks before a person is removed, and shows what goes with them. The apps the person
 * connected are their own accounts, so they are disconnected unless the remover unticks it.
 */
export function TeamModeRemoveDialog({
  member,
  all_members,
  on_cancel,
  on_remove,
}: {
  member: TeamMember;
  all_members: TeamMember[];
  on_cancel: () => void;
  on_remove: (keeps_connections: boolean) => void;
}) {
  const [disconnects, set_disconnects] = useState(true);
  const name = team_member_name(member);
  const connections_query = useQuery({
    queryKey: team_member_connections_query_key(member.user_id),
    queryFn: () => list_team_member_connections(member.user_id),
  });

  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : on_cancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are signed out at once. Their API keys are revoked, their scheduled tasks are
            switched off and their running chats are stopped. Their chats and files stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ConnectionsOfThePerson
          name={name}
          connections={connections_query.data ?? []}
          all_members={all_members}
          disconnects={disconnects}
          on_change={set_disconnects}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep {name}</AlertDialogCancel>
          <AlertDialogAction onClick={() => on_remove(!disconnects)}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConnectionsOfThePerson({
  name,
  connections,
  all_members,
  disconnects,
  on_change,
}: {
  name: string;
  connections: MemberConnection[];
  all_members: TeamMember[];
  disconnects: boolean;
  on_change: (disconnects: boolean) => void;
}) {
  const checkbox_id = useId();
  if (connections.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Checkbox id={checkbox_id} checked={disconnects} onCheckedChange={on_change} />
        <label htmlFor={checkbox_id}>Disconnect the apps {name} connected</label>
      </div>
      <ul className="flex flex-col gap-1 text-muted-foreground">
        {connections.map((connection) => (
          <li key={connection.connection_id}>
            {connection.connection_name}
            {words_for_who_else_uses_it(connection, all_members)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function words_for_who_else_uses_it(connection: MemberConnection, members: TeamMember[]) {
  const names = connection.also_used_by_user_ids.map((user_id) => {
    const person = members.find((member) => member.user_id === user_id);
    return person ? team_member_name(person) : 'someone who left';
  });
  return names.length > 0 ? `, also used by ${names.join(', ')}` : ', used by nobody else';
}
