import {
  as_person,
  call,
  invite_and_join,
  sign_in,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

use_a_fresh_team_install();

const team_schema = z.object({
  members: z.array(z.object({ user_id: z.string(), first_name: z.string().nullable() })),
});

async function names_on_the_team(viewer_user_id: string) {
  const team = team_schema.parse((await call('GET', '/v1/team', as_person(viewer_user_id))).data);
  return Object.fromEntries(team.members.map((member) => [member.user_id, member.first_name]));
}

const set_name = (user_id: string, body: unknown) =>
  call('PUT', '/v1/team/my-name', as_person(user_id), body);

describe('the name of the signed-in person on a team install', () => {
  it('is set by the person, and the team page and their session answer with it', async () => {
    const owner = await sign_the_owner_in();
    const ada = await invite_and_join(owner.user_id, 'Ada', 'member');

    const saved = await set_name(ada.user_id, { name: '  Ada Lovelace ' });

    expect(saved.status).toBe(200);
    expect(saved.data).toEqual({ name: 'Ada Lovelace' });
    expect((await names_on_the_team(owner.user_id))[ada.user_id]).toBe('Ada Lovelace');
    const session = await sign_in('session', { session_token: ada.session_token });
    expect(session.data.first_name).toBe('Ada Lovelace');
  });

  it('never changes the name of another person, whatever a member sends', async () => {
    const owner = await sign_the_owner_in();
    const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
    const ben = await invite_and_join(owner.user_id, 'Ben', 'member');
    const before = await names_on_the_team(owner.user_id);

    const named_another = await set_name(ada.user_id, { name: 'Mallory', user_id: ben.user_id });
    expect(named_another.status).toBe(422);
    expect(await names_on_the_team(owner.user_id)).toEqual(before);

    expect((await set_name(ada.user_id, { name: 'Mallory' })).status).toBe(200);
    expect(await names_on_the_team(owner.user_id)).toEqual({
      ...before,
      [ada.user_id]: 'Mallory',
    });
    expect(
      (await call('PUT', `/v1/team/members/${ben.user_id}`, as_person(ada.user_id), { name: 'X' }))
        .status,
    ).toBe(404);
  });

  it('refuses an empty name, and a person who is not on the team', async () => {
    const owner = await sign_the_owner_in();

    expect((await set_name(owner.user_id, { name: '   ' })).status).toBe(422);
    expect((await set_name('user_of_nobody', { name: 'Eve' })).status).toBe(401);
  });

  it('does not exist outside team mode, where the name comes from somewhere else', async () => {
    const owner = await sign_the_owner_in();
    vi.stubEnv('COWORKER_AUTH_MODE', 'local');

    expect((await set_name(owner.user_id, { name: 'Eve' })).status).toBe(404);
  });
});
