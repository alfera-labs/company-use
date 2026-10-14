import { format_person_name } from '@coworker/shared';
import type { WorkspaceMember } from '@/lib/api/endpoints';

export type GrantLevel = 'use' | 'manage';

export const grant_level_labels: Record<GrantLevel, string> = {
  use: 'Can use it',
  manage: 'Can manage it',
};

export function person_name(person: WorkspaceMember) {
  return format_person_name(person.first_name, person.last_name, person.email);
}

export function person_choice_label(person: WorkspaceMember) {
  const name = format_person_name(person.first_name, person.last_name);
  return name ? `${name} (${person.email})` : person.email;
}
