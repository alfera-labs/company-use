import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { TeamModeRoleSelect } from '@/components/app/team_mode_role_select';
import type { TeamChanges } from '@/components/app/use_team_mode';
import type { TeamRole } from '@/lib/api/team_mode';

export function TeamModeInviteRow({
  viewer_role,
  invite,
}: {
  viewer_role: string | null;
  invite: TeamChanges['invite'];
}) {
  const [name, set_name] = useState('');
  const [role, set_role] = useState<TeamRole>('member');
  const [email, set_email] = useState('');
  const clear_the_form = () => {
    set_name('');
    set_email('');
  };

  return (
    <form
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        const their_email = email.trim() ? { email: email.trim() } : {};
        invite.mutate({ name: name.trim(), role, ...their_email }, { onSuccess: clear_the_form });
      }}
    >
      <PersonFields name={name} email={email} set_name={set_name} set_email={set_email} />
      <TeamModeRoleSelect
        viewer_role={viewer_role}
        value={role}
        label="What they can do"
        class_name="min-w-0"
        on_change={set_role}
      />
      <Button type="submit" size="sm" disabled={!name.trim() || invite.isPending}>
        {invite.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Invite a person
      </Button>
    </form>
  );
}

function PersonFields(props: {
  name: string;
  email: string;
  set_name: (name: string) => void;
  set_email: (email: string) => void;
}) {
  return (
    <>
      <Input
        aria-label="Name of the person to invite"
        placeholder="Their name"
        maxLength={120}
        value={props.name}
        onChange={(event) => props.set_name(event.target.value)}
      />
      <Input
        type="email"
        aria-label="Their email in Slack and in mail, if the coworker should know them there"
        placeholder="Their email (optional)"
        title="For Slack and mail: the coworker knows them there by this address."
        maxLength={254}
        value={props.email}
        onChange={(event) => props.set_email(event.target.value)}
      />
    </>
  );
}
