import { Badge } from '@coworker/ui/components/badge';
import { Button } from '@coworker/ui/components/button';
import { useState } from 'react';
import { InitialsAvatar } from '@/components/app/team_initials_avatar';
import { TeamModeRemoveDialog } from '@/components/app/team_mode_remove_dialog';
import { TeamModeRoleSelect } from '@/components/app/team_mode_role_select';
import {
  is_the_only_owner,
  only_owner_stays_words,
  team_member_name,
  team_role_words,
  viewer_may_make_a_link,
  viewer_may_manage,
} from '@/components/app/team_mode_words';
import type { TeamChanges } from '@/components/app/use_team_mode';
import type { TeamMember, TeamRole } from '@/lib/api/team_mode';

type MemberRowProps = {
  member: TeamMember;
  all_members: TeamMember[];
  viewer_role: string | null;
  changes: TeamChanges;
};

export function TeamModeMemberRow({ is_you, ...row }: MemberRowProps & { is_you: boolean }) {
  const { member, viewer_role } = row;
  const name = team_member_name(member);

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <InitialsAvatar name={name} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="truncate font-medium text-sm">{name}</span>
        {is_you ? <Badge variant="secondary">You</Badge> : null}
        {member.member_status === 'invited' ? <Badge variant="caution">Invited</Badge> : null}
      </div>
      {viewer_may_manage(viewer_role, member) ? (
        <MemberActions {...row} />
      ) : (
        <span className="text-muted-foreground text-xs">
          {team_role_words[member.member_role as TeamRole] ?? member.member_role}
        </span>
      )}
    </li>
  );
}

function MemberActions({ member, all_members, viewer_role, changes }: MemberRowProps) {
  const name = team_member_name(member);
  const is_busy =
    changes.make_link.isPending || changes.change_role.isPending || changes.remove.isPending;
  const [asks_to_remove, set_asks_to_remove] = useState(false);
  const stays_as_owner = is_the_only_owner(member, all_members);

  return (
    <>
      <TeamModeRoleSelect
        viewer_role={viewer_role}
        value={member.member_role}
        label={`What ${name} can do`}
        class_name="h-8 w-28"
        disabled={is_busy || stays_as_owner}
        on_change={(role) => changes.change_role.mutate({ user_id: member.user_id, role })}
      />
      {viewer_may_make_a_link(viewer_role, member) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          title="For a new browser or a lost device. Using the link ends the person's other sessions."
          disabled={is_busy}
          onClick={() => changes.make_link.mutate(member)}
        >
          New sign-in link
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={is_busy || stays_as_owner}
        onClick={() => set_asks_to_remove(true)}
      >
        Remove
      </Button>
      {stays_as_owner ? <OnlyOwnerStaysNote /> : null}
      {asks_to_remove ? (
        <TeamModeRemoveDialog
          member={member}
          all_members={all_members}
          on_cancel={() => set_asks_to_remove(false)}
          on_remove={(keeps_connections) => changes.remove.mutate({ member, keeps_connections })}
        />
      ) : null}
    </>
  );
}

function OnlyOwnerStaysNote() {
  return (
    <p className="basis-full text-right text-muted-foreground text-xs">{only_owner_stays_words}</p>
  );
}
