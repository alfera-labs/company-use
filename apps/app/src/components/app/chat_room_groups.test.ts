import { describe, expect, it } from 'vitest';
import { build_chat_room_groups } from '@/components/app/chat_room_groups';
import type { Project, Session } from '@/lib/api/types';

function room(overrides: Partial<Project> & { project_id: string }): Project {
  return {
    workspace_id: 'ws_1',
    project_name: 'A room',
    project_status: 'active',
    project_access: 'members',
    is_workspace_default: false,
    project_description: null,
    project_instructions: null,
    membership_version: 1,
    personal_for_user_id: null,
    created_time: '2026-08-23T00:00:00Z',
    last_updated_time: '2026-08-23T00:00:00Z',
    ...overrides,
  };
}

function chat(overrides: Partial<Session> & { session_id: string }): Session {
  return {
    workspace_id: 'ws_1',
    agent_id: 'agt_1',
    project_id: null,
    session_title: 'A chat',
    session_status: 'active',
    session_source: 'dashboard',
    created_time: '2026-09-01T00:00:00Z',
    last_updated_time: '2026-09-01T00:00:00Z',
    last_message_time: '2026-09-01T00:00:00Z',
    ...overrides,
  } as Session;
}

const my_own_room = room({ project_id: 'proj_mine', personal_for_user_id: 'user_alice' });
const marketing = room({ project_id: 'proj_mkt', project_name: 'Marketing' });
const finance = room({ project_id: 'proj_fin', project_name: 'Finance' });

const names = (groups: ReturnType<typeof build_chat_room_groups>) =>
  groups.map((group) => group.group_name);

const default_room = room({
  project_id: 'proj_default',
  project_name: 'Workspace',
  project_access: 'workspace',
  is_workspace_default: true,
});

describe('gathering chats under the room they happened in', () => {
  it('names the default room after the workspace', () => {
    const groups = build_chat_room_groups(
      [chat({ session_id: 's1', project_id: default_room.project_id })],
      [my_own_room, default_room],
      'Northwind',
    );

    expect(names(groups)).toEqual(['Personal', 'Northwind']);
  });

  it('names the roomless group after the workspace when no default project exists', () => {
    const groups = build_chat_room_groups(
      [chat({ session_id: 's1', project_id: null })],
      [my_own_room],
      'Northwind',
    );

    expect(names(groups)).toEqual(['Personal', 'Northwind']);
  });

  it('falls back to Workspace while the name has not arrived', () => {
    const groups = build_chat_room_groups(
      [chat({ session_id: 's1', project_id: null })],
      [my_own_room],
      undefined,
    );

    expect(names(groups)).toEqual(['Personal', 'Workspace']);
  });

  it('folds roomless chats into the default project when one exists', () => {
    const groups = build_chat_room_groups(
      [
        chat({ session_id: 'ses_roomless', project_id: null }),
        chat({ session_id: 'ses_filed', project_id: 'proj_default' }),
      ],
      [default_room, my_own_room],
    );
    expect(names(groups)).toEqual(['Personal', 'Workspace']);
    expect(groups[1]?.project_id).toBe('proj_default');
    expect(groups[1]?.sessions).toHaveLength(2);
  });

  it('hides an empty default project entirely', () => {
    const groups = build_chat_room_groups(
      [chat({ session_id: 'ses_p', project_id: 'proj_mine' })],
      [default_room, my_own_room],
    );
    expect(names(groups)).toEqual(['Personal']);
  });

  it('keeps the workspace room last even when its chat is the newest', () => {
    const groups = build_chat_room_groups(
      [
        chat({
          session_id: 'ses_new_roomless',
          project_id: null,
          last_message_time: '2026-09-06T00:00:00Z',
        }),
        chat({
          session_id: 'ses_old_marketing',
          project_id: 'proj_mkt',
          last_message_time: '2026-09-01T00:00:00Z',
        }),
      ],
      [default_room, marketing],
    );
    expect(names(groups)).toEqual(['Marketing', 'Workspace']);
  });

  it('puts your own room first and the workspace last', () => {
    const groups = build_chat_room_groups(
      [
        chat({ session_id: 'ses_w', project_id: null }),
        chat({ session_id: 'ses_m', project_id: 'proj_mkt' }),
        chat({ session_id: 'ses_p', project_id: 'proj_mine' }),
      ],
      [marketing, my_own_room],
    );
    expect(names(groups)).toEqual(['Personal', 'Marketing', 'Workspace']);
  });

  it('floats the room with the newest chat above the others', () => {
    const groups = build_chat_room_groups(
      [
        chat({
          session_id: 'ses_old',
          project_id: 'proj_mkt',
          last_message_time: '2026-09-01T00:00:00Z',
        }),
        chat({
          session_id: 'ses_new',
          project_id: 'proj_fin',
          last_message_time: '2026-09-04T00:00:00Z',
        }),
      ],
      [marketing, finance],
    );
    expect(names(groups)).toEqual(['Finance', 'Marketing']);
  });

  it('keeps a room you have not used yet, below the rooms you have', () => {
    const groups = build_chat_room_groups(
      [chat({ session_id: 'ses_m', project_id: 'proj_mkt' })],
      [finance, marketing],
    );
    expect(names(groups)).toEqual(['Marketing', 'Finance']);
    expect(groups[1]?.sessions).toEqual([]);
  });

  it('orders the chats inside a room by recency', () => {
    const groups = build_chat_room_groups(
      [
        chat({
          session_id: 'ses_older',
          project_id: 'proj_mkt',
          last_message_time: '2026-09-01T00:00:00Z',
        }),
        chat({
          session_id: 'ses_newer',
          project_id: 'proj_mkt',
          last_message_time: '2026-09-03T00:00:00Z',
        }),
      ],
      [marketing],
    );
    expect(groups[0]?.sessions.map((session) => session.session_id)).toEqual([
      'ses_newer',
      'ses_older',
    ]);
  });

  it('hides the workspace group entirely when no chat is in it', () => {
    const groups = build_chat_room_groups(
      [chat({ session_id: 'ses_m', project_id: 'proj_mkt' })],
      [marketing],
    );
    expect(names(groups)).toEqual(['Marketing']);
  });

  it('keeps a chat whose room has not arrived yet', () => {
    const groups = build_chat_room_groups(
      [chat({ session_id: 'ses_unknown', project_id: 'proj_not_loaded' })],
      [],
    );
    expect(names(groups)).toEqual(['Elsewhere']);
    expect(groups[0]?.sessions).toHaveLength(1);
  });

  it('loses no chat, whatever room it claims', () => {
    const sessions = [
      chat({ session_id: 'a', project_id: null }),
      chat({ session_id: 'b', project_id: 'proj_mkt' }),
      chat({ session_id: 'c', project_id: 'proj_mine' }),
      chat({ session_id: 'd', project_id: 'proj_gone' }),
    ];
    const groups = build_chat_room_groups(sessions, [marketing, my_own_room]);
    expect(
      groups
        .flatMap((group) => group.sessions)
        .map((s) => s.session_id)
        .sort(),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});
