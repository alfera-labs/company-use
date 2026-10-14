import { workspace_room_name } from '@/components/app/chat_room_label';
import type { Project, Session } from '@/lib/api/types';

export type ChatRoomGroupKind = 'personal' | 'project' | 'workspace' | 'unplaced';

export type ChatRoomGroup = {
  group_key: string;
  group_name: string;
  group_kind: ChatRoomGroupKind;
  project_id: string | null;
  sessions: Session[];
};

export function build_chat_room_groups(
  sessions: readonly Session[],
  rooms_the_reader_is_in: readonly Project[],
  workspace_name?: string,
): ChatRoomGroup[] {
  const sessions_by_room = group_sessions_by_room_key(sessions, rooms_the_reader_is_in);

  return [
    ...personal_groups(rooms_the_reader_is_in, sessions_by_room),
    ...shared_groups(rooms_the_reader_is_in, sessions_by_room, workspace_name),
    ...workspace_group(sessions_by_room, workspace_name),
    ...unplaced_group(sessions_by_room),
  ];
}

const workspace_group_key = 'room:workspace';
const unplaced_group_key = 'room:unplaced';

function group_sessions_by_room_key(
  sessions: readonly Session[],
  rooms_the_reader_is_in: readonly Project[],
) {
  const known_room_ids = new Set(rooms_the_reader_is_in.map((room) => room.project_id));
  const default_room_id = rooms_the_reader_is_in.find(
    (room) => room.is_workspace_default,
  )?.project_id;
  const sessions_by_room = new Map<string, Session[]>();

  for (const session of sessions_ordered_by_recency(sessions)) {
    const room_key = !session.project_id
      ? (default_room_id ?? workspace_group_key)
      : known_room_ids.has(session.project_id)
        ? session.project_id
        : unplaced_group_key;
    const group = sessions_by_room.get(room_key);
    if (group) group.push(session);
    else sessions_by_room.set(room_key, [session]);
  }

  return sessions_by_room;
}

function personal_groups(
  rooms_the_reader_is_in: readonly Project[],
  sessions_by_room: Map<string, Session[]>,
) {
  return rooms_the_reader_is_in
    .filter((room) => room.personal_for_user_id !== null)
    .map((room) => ({
      group_key: room.project_id,
      group_name: 'Personal',
      group_kind: 'personal' as const,
      project_id: room.project_id,
      sessions: sessions_by_room.get(room.project_id) ?? [],
    }));
}

function shared_groups(
  rooms_the_reader_is_in: readonly Project[],
  sessions_by_room: Map<string, Session[]>,
  workspace_name?: string,
) {
  return rooms_the_reader_is_in
    .filter((room) => room.personal_for_user_id === null)
    .map((room) => ({
      group_key: room.project_id,
      group_name: room.is_workspace_default
        ? workspace_room_name(workspace_name)
        : room.project_name,
      group_kind: room.is_workspace_default ? ('workspace' as const) : ('project' as const),
      project_id: room.project_id,
      sessions: sessions_by_room.get(room.project_id) ?? [],
    }))
    .filter((room) => !(room.group_kind === 'workspace' && room.sessions.length === 0))
    .sort(by_newest_chat_then_name);
}

function workspace_group(sessions_by_room: Map<string, Session[]>, workspace_name?: string) {
  const sessions = sessions_by_room.get(workspace_group_key);
  if (!sessions?.length) return [];
  return [
    {
      group_key: workspace_group_key,
      group_name: workspace_room_name(workspace_name),
      group_kind: 'workspace' as const,
      project_id: null,
      sessions,
    },
  ];
}

function unplaced_group(sessions_by_room: Map<string, Session[]>) {
  const sessions = sessions_by_room.get(unplaced_group_key);
  if (!sessions?.length) return [];
  return [
    {
      group_key: unplaced_group_key,
      group_name: 'Elsewhere',
      group_kind: 'unplaced' as const,
      project_id: null,
      sessions,
    },
  ];
}

function by_newest_chat_then_name(left: ChatRoomGroup, right: ChatRoomGroup) {
  if (left.group_kind !== right.group_kind) {
    if (left.group_kind === 'workspace') return 1;
    if (right.group_kind === 'workspace') return -1;
  }
  const left_time = newest_session_time(left.sessions);
  const right_time = newest_session_time(right.sessions);
  if (left_time !== right_time) return right_time - left_time;
  return left.group_name.localeCompare(right.group_name);
}

function newest_session_time(sessions: readonly Session[]) {
  return sessions.length ? session_time(sessions[0] as Session) : 0;
}

function sessions_ordered_by_recency(sessions: readonly Session[]) {
  return [...sessions].sort((left, right) => session_time(right) - session_time(left));
}

function session_time(session: Session) {
  return new Date(
    session.last_message_time ?? session.last_updated_time ?? session.created_time ?? 0,
  ).getTime();
}
