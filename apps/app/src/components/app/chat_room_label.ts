import type { Project } from '@/lib/api/types';

const workspace_room_label = 'Workspace';

export function workspace_room_name(workspace_name: string | undefined): string {
  return workspace_name?.trim() || workspace_room_label;
}

export function read_shared_rooms(rooms_the_reader_is_in: readonly Project[]): Project[] {
  return rooms_the_reader_is_in.filter((room) => room.personal_for_user_id === null);
}

export function room_label(
  project_id: string | null,
  rooms: readonly Project[],
  workspace_name?: string,
): string {
  if (!project_id) return workspace_room_name(workspace_name);
  const room = rooms.find((one) => one.project_id === project_id);
  if (!room) return 'Project';
  if (room.personal_for_user_id) return 'Personal';
  if (room.is_workspace_default) return workspace_room_name(workspace_name);
  return room.project_name;
}

/**
 * The people who read every chat of a project, in words. Null for a person's own room, which
 * only that person reads.
 */
export function readers_of_room(room: Project, workspace_name?: string): string | null {
  if (room.personal_for_user_id) return null;
  if (room.project_access !== 'workspace') return `Everyone in the project ${room.project_name}`;
  return `Everyone in ${workspace_name?.trim() || 'this workspace'}`;
}
