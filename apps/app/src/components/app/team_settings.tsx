import { format_error_message, is_workspace_administrator_role } from '@coworker/shared';
import { Badge } from '@coworker/ui/components/badge';
import { Button } from '@coworker/ui/components/button';
import { SettingsCard } from '@coworker/ui/components/settings-card';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { person_name } from '@/components/app/project_member_words';
import { InitialsAvatar } from '@/components/app/team_initials_avatar';
import { use_revoke_workspace_invitation } from '@/components/app/team_invitation_mutations';
import { TeamInviteRow } from '@/components/app/team_invite_row';
import { MemberRoleSelect } from '@/components/app/team_member_role_select';
import { TeamSlackOnlyPeople } from '@/components/app/team_slack_only_people';
import type { MemberSlackWord } from '@/components/app/team_slack_status';
import { use_team_slack_status } from '@/components/app/use_team_slack_status';
import { list_workspace_invitations, list_workspace_members } from '@/lib/api';
import type { WorkspaceInvitation, WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import { useAuth } from '@/lib/auth_client';

export function TeamSettings() {
  const { user } = useAuth();
  const members_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const invitations_query = useQuery({
    queryKey: query_keys.workspace_invitations(),
    queryFn: list_workspace_invitations,
  });

  const members = members_query.data ?? [];
  const invitations = invitations_query.data ?? [];
  const error_message = read_error(members_query.error ?? invitations_query.error);
  const viewer = members.find((member) => is_same_address(member.email, user?.email ?? undefined));
  const viewer_is_administrator = is_workspace_administrator_role(viewer?.member_role);
  const slack_status = use_team_slack_status(members_query.data, invitations_query.data);

  return (
    <div className="flex flex-col gap-9">
      <SettingsCard>
        <div className="px-3.5 py-3.5">
          <TeamInviteRow />
        </div>

        {members_query.isLoading || invitations_query.isLoading ? (
          <div className="px-3.5 py-3.5">
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <MemberRow
                key={member.user_id}
                member={member}
                is_you={is_same_address(member.email, user?.email ?? undefined)}
                slack_word={slack_status.slack_word_by_user_id.get(member.user_id)}
                viewer_is_administrator={viewer_is_administrator}
              />
            ))}
            <InvitationRows invitations={invitations} />
          </ul>
        )}

        {members.length <= 1 && invitations.length === 0 ? <JustYouNote /> : null}
      </SettingsCard>

      <TeamSlackOnlyPeople status={slack_status} />

      {error_message ? <p className="text-destructive text-sm">{error_message}</p> : null}
    </div>
  );
}

function JustYouNote() {
  return (
    <p className="px-3.5 py-3.5 text-muted-foreground text-sm">
      It is just you here. Invite a teammate and they will appear in your projects.
    </p>
  );
}

function InvitationRows({ invitations }: { invitations: WorkspaceInvitation[] }) {
  const revoke = use_revoke_workspace_invitation();
  return invitations.map((invitation) => (
    <InvitationRow
      key={invitation.invitation_id}
      invitation={invitation}
      is_revoking={revoke.isPending}
      on_revoke={() => revoke.mutate(invitation.invitation_id)}
    />
  ));
}

function MemberRow({
  member,
  is_you,
  slack_word,
  viewer_is_administrator,
}: {
  member: WorkspaceMember;
  is_you: boolean;
  slack_word: MemberSlackWord | undefined;
  viewer_is_administrator: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <InitialsAvatar name={person_name(member)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-sm">{person_name(member)}</span>
          {is_you ? <Badge variant="secondary">You</Badge> : null}
        </div>
        <p className="truncate text-muted-foreground text-xs">
          {slack_word ? `${member.email} · ${slack_word}` : member.email}
        </p>
      </div>
      <MemberRoleSelect
        is_you={is_you}
        member={member}
        viewer_is_administrator={viewer_is_administrator}
      />
    </li>
  );
}

function InvitationRow({
  invitation,
  is_revoking,
  on_revoke,
}: {
  invitation: WorkspaceInvitation;
  is_revoking: boolean;
  on_revoke: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <InitialsAvatar name={invitation.email} />
      <span className="min-w-0 flex-1 truncate text-sm">{invitation.email}</span>
      <Badge variant="caution">Invited</Badge>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Withdraw the invitation to ${invitation.email}`}
        disabled={is_revoking}
        onClick={on_revoke}
      >
        <X className="size-4" />
      </Button>
    </li>
  );
}

function is_same_address(one: string, other: string | undefined) {
  return Boolean(other) && one.toLowerCase() === other?.toLowerCase();
}

function read_error(error: unknown) {
  if (!error) return null;
  return format_error_message(error, 'The team could not be loaded.');
}
