import { format_error_message } from '@coworker/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { set_workspace_member_role, type WorkspaceMember } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

const member_role_words: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const changeable_roles: Record<string, string> = { member: 'Member', admin: 'Admin' };

export function MemberRoleSelect({
  member,
  viewer_is_administrator,
  is_you,
}: {
  member: WorkspaceMember;
  viewer_is_administrator: boolean;
  is_you: boolean;
}) {
  const query_client = useQueryClient();
  const change = useMutation({
    mutationFn: (role: 'member' | 'admin') => set_workspace_member_role(member.user_id, role),
    onSuccess: async (changed) => {
      await query_client.invalidateQueries({ queryKey: query_keys.workspace_members() });
      toast.success(`${member.email} is now ${member_role_words[changed.member_role] ?? 'set'}.`);
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not change the seat')),
  });

  const can_change =
    viewer_is_administrator && !is_you && Object.hasOwn(changeable_roles, member.member_role);
  if (!can_change) {
    return (
      <span className="text-muted-foreground text-xs">
        {member_role_words[member.member_role] ?? member.member_role}
      </span>
    );
  }

  return (
    <Select
      items={changeable_roles}
      value={member.member_role}
      onValueChange={(value) => change.mutate(value as 'member' | 'admin')}
    >
      <SelectTrigger
        aria-label={`What ${member.email} can do`}
        className="h-8 w-28"
        disabled={change.isPending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(changeable_roles).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
