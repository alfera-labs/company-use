import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { create_api_session } from '@api/services/sessions_api/session_service';
import { create_api_key } from '@coworker/core/db/queries/api_keys';
import { find_personal_project } from '@coworker/core/db/queries/personal_projects';
import { open_scheduled_task_chat } from '@runtime-platform/events/scheduled_task_chat';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

use_a_fresh_team_install();

type Team = Awaited<ReturnType<typeof owner_admin_and_member>>;

const project_list_schema = z.array(
  z.object({ project_id: z.string(), is_workspace_default: z.boolean() }),
);

async function owner_admin_and_member() {
  const owner = await sign_the_owner_in();
  const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
  const member = await invite_and_join(owner.user_id, 'Ada', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  const projects = await call('GET', '/v1/projects', as_person(owner.user_id));
  const of_everyone = project_list_schema
    .parse(projects.data)
    .find((project) => project.is_workspace_default);
  return {
    owner,
    admin,
    member,
    workspace_id: String(workspace.data.workspace_id),
    workspace_name: String(workspace.data.workspace_name),
    project_of_everyone: of_everyone?.project_id ?? '',
  };
}

async function private_chat_of(user_id: string) {
  const chat = await call('POST', '/v1/sessions', as_person(user_id), {});
  expect(chat.status).toBe(201);
  return String(chat.data.session_id);
}

const move = (user_id: string, session_id: string, body: unknown) =>
  call('PATCH', `/v1/sessions/${session_id}`, as_person(user_id), body);

const remove_chat = (user_id: string, session_id: string) =>
  call('DELETE', `/v1/sessions/${session_id}`, as_person(user_id));

const opens = async (user_id: string, session_id: string) =>
  (await call('GET', `/v1/sessions/${session_id}`, as_person(user_id))).status;

const chat_row_schema = z.array(
  z.object({ session_id: z.string(), reader_may_move_or_delete_it: z.boolean() }),
);

async function row_listed_for(user_id: string, session_id: string) {
  const listed = await call('GET', '/v1/sessions', as_person(user_id));
  expect(listed.status).toBe(200);
  return chat_row_schema.parse(listed.data).find((chat) => chat.session_id === session_id);
}

async function shared_chat_of_the_owner(team: Team) {
  const session_id = await private_chat_of(team.owner.user_id);
  const shared = await move(team.owner.user_id, session_id, {
    project_id: team.project_of_everyone,
    share_with_its_readers: true,
  });
  expect(shared.status).toBe(200);
  return session_id;
}

describe('moving a private chat where other people read it, in team mode', () => {
  it('refuses the move until the request says yes, and says who will read the chat', async () => {
    const team = await owner_admin_and_member();
    const session_id = await private_chat_of(team.owner.user_id);

    const refused = await move(team.owner.user_id, session_id, {
      project_id: team.project_of_everyone,
    });

    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe('chat_move_shares_the_chat');
    expect(refused.error?.message).toContain(
      `Everyone in ${team.workspace_name} will be able to read this chat.`,
    );
    expect(await opens(team.member.user_id, session_id)).toBe(404);
    expect(await row_listed_for(team.member.user_id, session_id)).toBeUndefined();
  });

  it('shares the chat with every member once the request says yes', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of_the_owner(team);

    expect(await opens(team.member.user_id, session_id)).toBe(200);
    expect(await opens(team.admin.user_id, session_id)).toBe(200);
  });

  it('makes the chat private again when its maker moves it back to their own room', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of_the_owner(team);
    const own_room = await find_personal_project(db, { ...team, user_id: team.owner.user_id });

    const back = await move(team.owner.user_id, session_id, { project_id: own_room?.project_id });

    expect(back.status).toBe(200);
    expect(await opens(team.member.user_id, session_id)).toBe(404);
    expect(await opens(team.admin.user_id, session_id)).toBe(404);
    expect(await opens(team.owner.user_id, session_id)).toBe(200);
  });

  it('names the project when only the people of one project will read the chat', async () => {
    const team = await owner_admin_and_member();
    const session_id = await private_chat_of(team.owner.user_id);
    const launch = await call('POST', '/v1/projects', as_person(team.owner.user_id), {
      project_name: 'Launch',
    });

    const refused = await move(team.owner.user_id, session_id, {
      project_id: launch.data.project_id,
    });

    expect(refused.status).toBe(409);
    expect(refused.error?.message).toContain(
      'Everyone in the project Launch will be able to read this chat.',
    );
  });

  it('asks an API key for the same yes', async () => {
    const team = await owner_admin_and_member();
    const { secret, api_key } = await create_api_key(db, {
      workspace_id: team.workspace_id,
      key_name: 'A key',
      scopes: ['sessions.read', 'sessions.write'],
      key_audience: 'internal',
      environment_label: 'live',
      actor_id: team.owner.user_id,
    });
    const chat = await create_api_session(
      db,
      { api_key, initial_events: [], metadata: {} },
      undefined,
    );
    const with_key = { authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
    const path = `/v1/sessions/${chat.session_id}`;

    const refused = await call('PATCH', path, with_key, { project_id: team.project_of_everyone });
    expect(refused.status).toBe(409);
    expect(await opens(team.member.user_id, chat.session_id)).toBe(404);

    const shared = await call('PATCH', path, with_key, {
      project_id: team.project_of_everyone,
      share_with_its_readers: true,
    });
    expect(shared.status).toBe(200);
    expect(await opens(team.member.user_id, chat.session_id)).toBe(200);
  });

  it('asks for no yes outside team mode, as before', async () => {
    const team = await owner_admin_and_member();
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const session_id = await private_chat_of(team.owner.user_id);

    const moved = await move(team.owner.user_id, session_id, {
      project_id: team.project_of_everyone,
    });

    expect(moved.status).toBe(200);
    expect(moved.data.project_id).toBe(team.project_of_everyone);
  });
});

describe('who moves or deletes a chat other people read, in team mode', () => {
  it('lets a member read the shared chat of the owner, and neither delete nor move it', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of_the_owner(team);
    const own_room = await find_personal_project(db, { ...team, user_id: team.member.user_id });

    const deleted = await remove_chat(team.member.user_id, session_id);
    const moved = await move(team.member.user_id, session_id, { project_id: own_room?.project_id });

    expect(deleted.status).toBe(403);
    expect(deleted.error?.message).toBe(
      'Only the person who started this chat, or an owner or an admin, can delete it.',
    );
    expect(moved.status).toBe(403);
    expect(await opens(team.owner.user_id, session_id)).toBe(200);
  });

  it('tells each reader in the chat list whether they may move or delete the chat', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of_the_owner(team);
    const may = async (user_id: string) =>
      (await row_listed_for(user_id, session_id))?.reader_may_move_or_delete_it;

    expect(await may(team.owner.user_id)).toBe(true);
    expect(await may(team.admin.user_id)).toBe(true);
    expect(await may(team.member.user_id)).toBe(false);
  });

  it('lets an admin delete the shared chat of the owner', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of_the_owner(team);

    expect((await remove_chat(team.admin.user_id, session_id)).status).toBe(200);
    expect(await row_listed_for(team.owner.user_id, session_id)).toBeUndefined();
  });

  it('lets a member delete a chat they started in a shared project', async () => {
    const team = await owner_admin_and_member();
    const session_id = await private_chat_of(team.member.user_id);
    await move(team.member.user_id, session_id, {
      project_id: team.project_of_everyone,
      share_with_its_readers: true,
    });

    expect((await remove_chat(team.member.user_id, session_id)).status).toBe(200);
  });

  it('lets a member delete the chat of a scheduled task she made, which nobody else reads', async () => {
    const team = await owner_admin_and_member();
    const chat = await open_scheduled_task_chat(
      db,
      {
        workspace_id: team.workspace_id,
        agent_id: await main_agent_id(as_person(team.member.user_id)),
        trigger_id: 'trg_member',
        trigger_name: 'Member report',
        created_by: team.member.user_id,
      },
      {},
    );
    const row = await row_listed_for(team.member.user_id, chat.session_id);

    expect(row?.reader_may_move_or_delete_it).toBe(true);
    expect((await remove_chat(team.member.user_id, chat.session_id)).status).toBe(200);
  });

  it('keeps a removed member from deleting or moving anything', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of_the_owner(team);
    const removal = `/v1/team/members/${team.member.user_id}`;
    expect((await call('DELETE', removal, as_person(team.owner.user_id))).status).toBe(200);

    const deleted = await remove_chat(team.member.user_id, session_id);
    const moved = await move(team.member.user_id, session_id, { project_id: null });

    expect(deleted.status).toBeGreaterThanOrEqual(400);
    expect(moved.status).toBeGreaterThanOrEqual(400);
    expect(await opens(team.owner.user_id, session_id)).toBe(200);
  });

  it('lets any reader delete a chat outside team mode, as before', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of_the_owner(team);
    vi.stubEnv('COWORKER_AUTH_MODE', '');

    const row = await row_listed_for(team.member.user_id, session_id);
    expect(row?.reader_may_move_or_delete_it).toBe(true);
    expect((await remove_chat(team.member.user_id, session_id)).status).toBe(200);
  });
});
