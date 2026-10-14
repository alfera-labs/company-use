import {
  project_is_ticked,
  read_connection_audience,
  read_project_tick,
} from '@/components/app/connection_audience';
import type { ResourceSharing } from '@/lib/api/endpoints';

export type RoomConnectionState = 'available' | 'addable' | 'convert' | 'private';

export function read_room_connection_state(
  sharing: ResourceSharing,
  project_id: string,
  owner_user_id?: string | null,
): RoomConnectionState {
  if (read_connection_audience(sharing).kind === 'everyone') return 'available';
  if (project_is_ticked(sharing, project_id)) return 'available';

  const tick = read_project_tick(sharing, project_id, owner_user_id);
  if (tick.allowed === 'add') return 'addable';
  if (tick.allowed === 'convert_from_only_person') return 'convert';
  return 'private';
}

export type ProjectRemoval =
  | { kind: 'untick' }
  | { kind: 'make_owner_only'; owner_user_id: string }
  | { kind: 'needs_everyone_confirm' }
  | { kind: 'nothing' };

export function read_project_removal(
  sharing: ResourceSharing,
  project_id: string,
  owner_user_id?: string | null,
): ProjectRemoval {
  if (!project_is_ticked(sharing, project_id)) return { kind: 'nothing' };

  const tick = read_project_tick(sharing, project_id, owner_user_id);
  if (tick.allowed === 'remove') return { kind: 'untick' };
  if (tick.allowed !== 'open_to_everyone') return { kind: 'nothing' };
  return owner_user_id
    ? { kind: 'make_owner_only', owner_user_id }
    : { kind: 'needs_everyone_confirm' };
}
