import { Button } from '@coworker/ui/components/button';
import { InitialsAvatar } from '@/components/app/team_initials_avatar';
import { use_send_workspace_invitation } from '@/components/app/team_invitation_mutations';
import type { TeamSlackStatus } from '@/components/app/team_slack_status';
import type { WorkspaceSlackPerson } from '@/lib/api/workspace_slack_people';

export function TeamSlackOnlyPeople({ status }: { status: TeamSlackStatus }) {
  const invite = use_send_workspace_invitation();
  if (status.slack_only_people.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-foreground text-sm">In Slack only</h2>
      <ul className="panel divide-y divide-border overflow-hidden">
        {status.slack_only_people.map((person) => (
          <SlackOnlyPersonRow
            key={person.slack_user_id}
            person={person}
            is_inviting={invite.isPending}
            on_invite={(email) => invite.mutate({ email, role: 'member' })}
          />
        ))}
      </ul>
      {status.slack_only_more_count > 0 ? (
        <p className="text-muted-foreground text-xs">and {status.slack_only_more_count} more</p>
      ) : null}
    </section>
  );
}

function SlackOnlyPersonRow({
  person,
  is_inviting,
  on_invite,
}: {
  person: WorkspaceSlackPerson;
  is_inviting: boolean;
  on_invite: (email: string) => void;
}) {
  const email = person.email;
  const second_line = [email === person.name ? null : email, person.is_guest ? 'Guest' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <InitialsAvatar name={person.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-sm">{person.name}</span>
        </div>
        {second_line ? (
          <p className="truncate text-muted-foreground text-xs">{second_line}</p>
        ) : null}
      </div>
      {email ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Invite ${email}`}
          disabled={is_inviting}
          onClick={() => on_invite(email)}
        >
          Invite
        </Button>
      ) : null}
    </li>
  );
}
