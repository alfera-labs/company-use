import {
  as_person,
  call,
  invite_and_join,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

use_a_fresh_team_install();

const project_list_schema = z.array(
  z.object({ project_id: z.string(), is_workspace_default: z.boolean() }),
);

async function owner_admin_and_member() {
  const owner = await sign_the_owner_in();
  const admin = await invite_and_join(owner.user_id, 'Sam', 'admin');
  const member = await invite_and_join(owner.user_id, 'Dana', 'member');
  const projects = await call('GET', '/v1/projects', as_person(owner.user_id));
  const of_everyone = project_list_schema
    .parse(projects.data)
    .find((project) => project.is_workspace_default);
  return { owner, admin, member, project_of_everyone: of_everyone?.project_id ?? '' };
}

async function shared_chat_of(user_id: string, project_id: string) {
  const chat = await call('POST', '/v1/sessions', as_person(user_id), {});
  expect(chat.status).toBe(201);
  const session_id = String(chat.data.session_id);
  const named = await rename(user_id, session_id, 'Plan for the week');
  expect(named.status).toBe(200);
  const shared = await call('PATCH', `/v1/sessions/${session_id}`, as_person(user_id), {
    project_id,
    share_with_its_readers: true,
  });
  expect(shared.status).toBe(200);
  return session_id;
}

const rename = (user_id: string, session_id: string, session_title: string) =>
  call('PATCH', `/v1/sessions/${session_id}`, as_person(user_id), { session_title });

const title_read_by = async (user_id: string, session_id: string) =>
  (await call('GET', `/v1/sessions/${session_id}`, as_person(user_id))).data.session_title;

describe('who renames a chat other people read, in team mode', () => {
  it('lets a member read the shared chat of the owner, and not rename it', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of(team.owner.user_id, team.project_of_everyone);

    const renamed = await rename(team.member.user_id, session_id, 'Renamed by a reader');

    expect(renamed.status).toBe(403);
    expect(renamed.error?.message).toBe(
      'Only the person who started this chat, or an owner or an admin, can rename it.',
    );
    expect(await title_read_by(team.member.user_id, session_id)).toBe('Plan for the week');
  });

  it('lets the owner rename the chat they started and shared', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of(team.owner.user_id, team.project_of_everyone);

    const renamed = await rename(team.owner.user_id, session_id, 'Plan for the month');

    expect(renamed.status).toBe(200);
    expect(await title_read_by(team.member.user_id, session_id)).toBe('Plan for the month');
  });

  it('lets an admin rename the shared chat of the owner', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of(team.owner.user_id, team.project_of_everyone);

    const renamed = await rename(team.admin.user_id, session_id, 'Renamed by an admin');

    expect(renamed.status).toBe(200);
    expect(await title_read_by(team.owner.user_id, session_id)).toBe('Renamed by an admin');
  });

  it('lets a member rename a chat they started in a shared project, and an owner too', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of(team.member.user_id, team.project_of_everyone);

    expect((await rename(team.member.user_id, session_id, 'Renamed by its maker')).status).toBe(
      200,
    );
    expect((await rename(team.owner.user_id, session_id, 'Renamed by the owner')).status).toBe(200);
    expect(await title_read_by(team.member.user_id, session_id)).toBe('Renamed by the owner');
  });

  it('keeps a removed member from renaming anything', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of(team.owner.user_id, team.project_of_everyone);
    const removal = `/v1/team/members/${team.member.user_id}`;
    expect((await call('DELETE', removal, as_person(team.owner.user_id))).status).toBe(200);

    const renamed = await rename(team.member.user_id, session_id, 'Renamed after the removal');

    expect(renamed.status).toBeGreaterThanOrEqual(400);
    expect(await title_read_by(team.owner.user_id, session_id)).toBe('Plan for the week');
  });

  it('lets any reader rename a chat outside team mode, as before', async () => {
    const team = await owner_admin_and_member();
    const session_id = await shared_chat_of(team.owner.user_id, team.project_of_everyone);
    vi.stubEnv('COWORKER_AUTH_MODE', '');

    const renamed = await rename(team.member.user_id, session_id, 'Renamed by a reader');

    expect(renamed.status).toBe(200);
    expect(await title_read_by(team.owner.user_id, session_id)).toBe('Renamed by a reader');
  });
});
