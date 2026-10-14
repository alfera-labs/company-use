import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { use_send_workspace_invitation } from '@/components/app/team_invitation_mutations';
import type { WorkspaceInvitationRole } from '@/lib/api/endpoints';

const invitation_role_labels: Record<WorkspaceInvitationRole, string> = {
  member: 'Member',
  admin: 'Admin',
};

export function TeamInviteRow() {
  const [email, set_email] = useState('');
  const [role, set_role] = useState<WorkspaceInvitationRole>('member');
  const invite = use_send_workspace_invitation();

  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!email.trim()) return;
        invite.mutate({ email: email.trim(), role }, { onSuccess: () => set_email('') });
      }}
    >
      <Input
        type="email"
        aria-label="Teammate email"
        placeholder="teammate@company.com"
        value={email}
        onChange={(event) => set_email(event.target.value)}
      />
      <Select
        items={invitation_role_labels}
        value={role}
        onValueChange={(value) => set_role(value as WorkspaceInvitationRole)}
      >
        <SelectTrigger aria-label="What they can do" className="min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(invitation_role_labels).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={!email.trim() || invite.isPending}>
        {invite.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Invite
      </Button>
    </form>
  );
}
