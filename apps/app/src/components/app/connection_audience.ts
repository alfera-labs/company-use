import { format_person_name } from '@coworker/shared';
import type { ResourceSharing, SharingGrantee, WorkspaceMember } from '@/lib/api/endpoints';
import type { Project } from '@/lib/api/types';

export type ConnectionAudience =
  | { kind: 'everyone' }
  | { kind: 'only_person'; person_id: string }
  | { kind: 'people'; person_ids: string[] }
  | { kind: 'projects'; project_ids: string[] }
  | { kind: 'custom' };

type SharingBody = {
  shared_with_everyone_in_the_workspace: boolean;
  shared_with: SharingGrantee[];
  replaces?: SharingGrantee[];
};

export function read_connection_audience(sharing: ResourceSharing): ConnectionAudience {
  if (sharing.shared_with.length === 0) return { kind: 'everyone' };

  const project_ids = sharing.shared_with.flatMap((entry) =>
    'project' in entry ? [entry.project] : [],
  );
  if (project_ids.length === sharing.shared_with.length) {
    return { kind: 'projects', project_ids };
  }

  const person_ids = sharing.shared_with.flatMap((entry) =>
    'person' in entry ? [entry.person] : [],
  );
  if (person_ids.length !== sharing.shared_with.length) return { kind: 'custom' };

  const [only_person_id] = person_ids;
  return person_ids.length === 1 && only_person_id
    ? { kind: 'only_person', person_id: only_person_id }
    : { kind: 'people', person_ids };
}

export function audience_label(
  audience: ConnectionAudience,
  rooms: readonly Project[],
  options: {
    members?: readonly WorkspaceMember[];
    viewer_user_id?: string;
    current_project_id?: string;
  } = {},
): string {
  if (audience.kind === 'everyone') return 'Everyone';
  if (audience.kind === 'custom') return 'Custom';
  if (audience.kind === 'only_person') {
    return `Only ${person_label(audience.person_id, options.members, options.viewer_user_id)}`;
  }
  if (audience.kind === 'people') return people_label(audience.person_ids, options.members);

  const names = audience.project_ids.map(
    (project_id) =>
      rooms.find((room) => room.project_id === project_id)?.project_name ?? '1 project',
  );
  const current_project_id = options.current_project_id;
  if (current_project_id && !audience.project_ids.includes(current_project_id)) {
    return names.length === 1 ? `Only ${names[0]}` : `${names.length} projects, not this one`;
  }
  if (names.length === 1) return `Only ${names[0]}`;
  return `${names.length} projects`;
}

function person_label(
  person_id: string,
  members: readonly WorkspaceMember[] | undefined,
  viewer_user_id: string | undefined,
): string {
  const said = member_name(members?.find((candidate) => candidate.user_id === person_id));
  return person_id === viewer_user_id ? `${said} (you)` : said;
}

function people_label(
  person_ids: readonly string[],
  members: readonly WorkspaceMember[] | undefined,
): string {
  if (person_ids.length !== 2) return `${person_ids.length} people`;
  return person_ids
    .map((person_id) => member_name(members?.find((member) => member.user_id === person_id)))
    .join(' and ');
}

export function member_name(member: WorkspaceMember | undefined): string {
  return format_person_name(member?.first_name, member?.last_name, member?.email || 'one person');
}

export function member_first_name(member: WorkspaceMember | undefined): string | undefined {
  return member?.first_name || member?.email || undefined;
}

export function audience_write_refusal(
  status: number | undefined,
  owner_first_name: string | undefined,
): string | null {
  if (status !== 403) return null;
  return `${owner_first_name ?? 'An admin'} owns this connection. Ask them or an admin to change it.`;
}

export function everyone_label(workspace_name: string | undefined): string {
  return workspace_name ? `Everyone at ${workspace_name}` : 'Everyone';
}

export function audience_key(sharing: ResourceSharing): string {
  const audience = read_connection_audience(sharing);
  if (audience.kind === 'projects') {
    return `projects:${[...audience.project_ids].sort().join(',')}`;
  }
  if (audience.kind === 'only_person') return `only_person:${audience.person_id}`;
  if (audience.kind === 'people') return `people:${[...audience.person_ids].sort().join(',')}`;
  return audience.kind;
}

export function body_for_everyone(): SharingBody {
  return { shared_with_everyone_in_the_workspace: true, shared_with: [] };
}

export function body_for_only_person(person_id: string): SharingBody {
  return {
    shared_with_everyone_in_the_workspace: false,
    shared_with: [{ person: person_id, can: 'use' }],
  };
}

export function body_for_projects(project_ids: readonly string[]): SharingBody {
  return {
    shared_with_everyone_in_the_workspace: false,
    shared_with: project_ids.map((project_id) => ({ project: project_id, can: 'use' })),
  };
}

export function replacing(sharing: ResourceSharing, body: SharingBody): SharingBody {
  return { ...body, replaces: sharing.shared_with };
}

export function audience_went_stale(status: number | undefined): boolean {
  return status === 409;
}

export function project_is_ticked(sharing: ResourceSharing, project_id: string): boolean {
  return sharing.shared_with.some((entry) => 'project' in entry && entry.project === project_id);
}

export type ProjectTick =
  | { allowed: 'add' }
  | { allowed: 'remove' }
  | { allowed: 'convert_from_only_person' }
  | { allowed: 'open_to_everyone' }
  | { allowed: 'no'; reason: string };

export function read_project_tick(
  sharing: ResourceSharing,
  project_id: string,
  owner_user_id?: string | null,
): ProjectTick {
  const audience = read_connection_audience(sharing);
  if (audience.kind === 'custom') {
    return {
      allowed: 'no',
      reason:
        'An admin set a custom audience for this connection, naming people as well as projects. ' +
        'Change it on the connection settings page so nothing here is lost.',
    };
  }
  if (audience.kind === 'only_person' && audience.person_id === owner_user_id) {
    return { allowed: 'convert_from_only_person' };
  }
  if (audience.kind === 'only_person' || audience.kind === 'people') {
    const who = audience.kind === 'people' ? 'named people' : 'one person';
    return {
      allowed: 'no',
      reason: `This connection is set to ${who}. Choose Everyone first, then pick the projects it belongs to.`,
    };
  }
  if (audience.kind === 'everyone') return { allowed: 'add' };
  if (!audience.project_ids.includes(project_id)) return { allowed: 'add' };
  return audience.project_ids.length === 1
    ? { allowed: 'open_to_everyone' }
    : { allowed: 'remove' };
}
