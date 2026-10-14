import { format_error_message } from '@coworker/shared';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useState } from 'react';
import { EmptyNote } from '@/components/app/empty_note';
import { TeamModeInviteRow } from '@/components/app/team_mode_invite_row';
import { type ShownSignInLink, TeamModeLinkBox } from '@/components/app/team_mode_link_box';
import { TeamModeMemberRow } from '@/components/app/team_mode_member_row';
import {
  roles_the_viewer_may_give,
  what_members_share_words,
  where_people_open_it_words,
} from '@/components/app/team_mode_words';
import { type TeamChanges, use_team, use_team_changes } from '@/components/app/use_team_mode';
import type { Team } from '@/lib/api/team_mode';

const words_for_who_manages =
  'A person signs in with a one-time link, and there is no password. Whoever opens a link is signed in as that person, so send each link only to the person it is for. "New sign-in link" is for a new browser or a lost device: when the link is used, the other sessions of that person end, and the person is told that a link was used.';
const words_for_a_member = 'An owner or an admin invites people and makes sign-in links.';

/** Settings → Team when the install signs people in itself, with one-time links. */
export function TeamModeSettings() {
  const [shown_link, set_shown_link] = useState<ShownSignInLink | null>(null);
  const team_query = use_team();
  const changes = use_team_changes(set_shown_link);
  const team = team_query.data;
  const viewer_role = team?.viewer_role ?? null;
  const viewer_may_invite = roles_the_viewer_may_give(viewer_role).length > 0;

  return (
    <div className="flex flex-col gap-5">
      {viewer_may_invite && team ? (
        <EmptyNote>{where_people_open_it_words(team.open_at)}</EmptyNote>
      ) : null}
      {viewer_may_invite ? (
        <TeamModeInviteRow viewer_role={viewer_role} invite={changes.invite} />
      ) : null}
      {viewer_may_invite ? (
        <p className="text-muted-foreground text-sm">{what_members_share_words}</p>
      ) : null}
      {shown_link && team ? (
        <TeamModeLinkBox
          key={shown_link.token}
          link={shown_link}
          open_at={team.open_at}
          on_done={() => set_shown_link(null)}
        />
      ) : null}
      {team ? <TeamMemberList team={team} changes={changes} /> : null}
      {team_query.isLoading ? <Skeleton className="h-24 w-full rounded-2xl" /> : null}
      <p className="text-muted-foreground text-sm">
        {viewer_may_invite ? words_for_who_manages : words_for_a_member}
      </p>
      {team_query.error ? (
        <p className="text-destructive text-sm">
          {format_error_message(team_query.error, 'The team could not be loaded.')}
        </p>
      ) : null}
    </div>
  );
}

function TeamMemberList({ team, changes }: { team: Team; changes: TeamChanges }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border">
      {team.members.map((member) => (
        <TeamModeMemberRow
          key={member.user_id}
          member={member}
          all_members={team.members}
          is_you={member.user_id === team.viewer_user_id}
          viewer_role={team.viewer_role}
          changes={changes}
        />
      ))}
    </ul>
  );
}
