import { Button } from '@coworker/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { Link } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import type { ProjectMemberControlsProps } from '@/components/app/project_member_controls';
import {
  type GrantLevel,
  grant_level_labels,
  person_choice_label,
} from '@/components/app/project_member_words';
import type { WorkspaceMember } from '@/lib/api/endpoints';
import type { ProjectMember } from '@/lib/api/types';
import { settings_section_path } from '@/lib/settings_navigation';

export function AddProjectMemberForm(props: ProjectMemberControlsProps) {
  const choices = available_teammates(props.members, props.people);
  const workspace_person = props.project.project_access === 'workspace';

  if (choices.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Invite teammates in{' '}
        <Link className="underline hover:text-foreground" to={settings_section_path('team')}>
          Settings → Team
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
      <Select
        items={Object.fromEntries(choices.map((choice) => [choice.id, choice.label]))}
        value={props.grantee_id}
        onValueChange={(value) => props.set_grantee_id(value ?? '')}
      >
        <SelectTrigger aria-label="Which teammate" className="min-w-0">
          <SelectValue placeholder="Choose a teammate" />
        </SelectTrigger>
        <SelectContent className="w-auto min-w-[calc(var(--anchor-width)+8rem)] max-w-[28rem]">
          {choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={grant_level_labels}
        value={workspace_person ? 'manage' : props.grant_level}
        disabled={workspace_person}
        onValueChange={(value) => props.set_grant_level(value as GrantLevel)}
      >
        <SelectTrigger aria-label="What they can do">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(grant_level_labels).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        disabled={!props.grantee_id || props.is_adding}
        onClick={props.add_member}
      >
        {props.is_adding ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Add
      </Button>
    </div>
  );
}

function available_teammates(members: ProjectMember[], people: WorkspaceMember[]) {
  const member_ids = new Set(
    members.filter((member) => member.grantee_type === 'user').map((member) => member.grantee_id),
  );
  return people
    .filter((person) => !member_ids.has(person.user_id))
    .map((person) => ({ id: person.user_id, label: person_choice_label(person) }));
}
