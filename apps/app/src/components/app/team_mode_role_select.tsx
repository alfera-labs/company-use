import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { roles_the_viewer_may_give, team_role_words } from '@/components/app/team_mode_words';
import type { TeamRole } from '@/lib/api/team_mode';

/** A role picker that offers only the roles the viewer may give. */
export function TeamModeRoleSelect({
  viewer_role,
  value,
  label,
  class_name,
  disabled,
  on_change,
}: {
  viewer_role: string | null;
  value: string;
  label: string;
  class_name: string;
  disabled?: boolean;
  on_change: (role: TeamRole) => void;
}) {
  const roles = roles_the_viewer_may_give(viewer_role);
  const role_labels = Object.fromEntries(roles.map((role) => [role, team_role_words[role]]));
  return (
    <Select items={role_labels} value={value} onValueChange={(role) => on_change(role as TeamRole)}>
      <SelectTrigger aria-label={label} className={class_name} disabled={disabled}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {team_role_words[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
