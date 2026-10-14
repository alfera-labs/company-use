import {
  as_person,
  call,
  db,
  invite,
  invite_and_join,
  join_with,
  sign_in,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { team_sessions } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

use_a_fresh_team_install();

const session_status = async (session_token: string) =>
  (await sign_in('session', { session_token })).status;

async function new_link_for(actor_user_id: string, user_id: string) {
  const link = await call(
    'POST',
    `/v1/team/members/${user_id}/sign-in-link`,
    as_person(actor_user_id),
  );
  expect(link.status).toBe(201);
  return String(link.data.token);
}

const arrival_of = async (user_id: string) =>
  (await call('POST', '/v1/team/arrival', as_person(user_id))).data;

describe('a new sign-in link for a person who has joined', () => {
  it('ends every earlier session of that person when it is used, and nobody else session', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const second_browser = await join_with(await new_link_for(owner.user_id, member.user_id));
    expect(await session_status(member.session_token)).toBe(401);
    expect(await session_status(second_browser.session_token)).toBe(200);
    expect(await session_status(owner.session_token)).toBe(200);

    const stolen_cookie = owner.session_token;
    const owner_again = await sign_the_owner_in();
    expect(await session_status(stolen_cookie)).toBe(401);
    expect(await session_status(owner_again.session_token)).toBe(200);
    expect(await session_status(second_browser.session_token)).toBe(200);
    expect(await db.select().from(team_sessions)).toHaveLength(2);
  });

  it('does not end a session while the link is only made, or only looked at', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const token = await new_link_for(owner.user_id, member.user_id);
    const preview = await sign_in('link/preview', { token });
    expect(preview.status).toBe(200);
    expect(preview.data.has_joined_before).toBe(true);
    expect(await session_status(member.session_token)).toBe(200);
  });

  it('tells nothing at the first sign-in of the owner or of an invited person', async () => {
    const owner = await sign_the_owner_in();
    expect((await arrival_of(owner.user_id)).sign_in_notice).toBeNull();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    expect((await arrival_of(member.user_id)).sign_in_notice).toBeNull();
  });

  it('tells a person about the sign-in before this one, and never the session that link made', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const team = await call('GET', '/v1/team', as_person(owner.user_id));
    const owner_name = (team.data.members as { first_name: string | null }[])[0]?.first_name;
    const seen = () => call('POST', '/v1/team/sign-in-notice/seen', as_person(member.user_id));

    await join_with(await new_link_for(owner.user_id, member.user_id));
    const told_to_the_one_who_took_it = (await arrival_of(member.user_id)).sign_in_notice;
    expect(told_to_the_one_who_took_it).toMatchObject({ link_kind: 'invitation' });
    expect((await seen()).status).toBe(200);
    expect((await arrival_of(member.user_id)).sign_in_notice).toBeNull();

    await join_with(await new_link_for(owner.user_id, member.user_id));
    const told = await arrival_of(member.user_id);
    expect(told.viewer_role).toBe('member');
    expect(told.sign_in_notice).toMatchObject({
      link_kind: 'new_link',
      made_by_name: owner_name ?? 'a person who has left',
    });
    const notice = told.sign_in_notice as { used_time: string };
    expect(Date.now() - Date.parse(notice.used_time)).toBeLessThan(60_000);
    expect((await arrival_of(member.user_id)).sign_in_notice).toEqual(told.sign_in_notice);
    await seen();
    expect((await arrival_of(member.user_id)).sign_in_notice).toBeNull();
  });

  it('keeps the recent sign-ins of a person for that person to read, newest first', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    await join_with(await new_link_for(owner.user_id, member.user_id));
    await sign_the_owner_in();

    const of_member = await call('GET', '/v1/team/me', as_person(member.user_id));
    const of_owner = await call('GET', '/v1/team/me', as_person(owner.user_id));

    const kinds = (account: typeof of_member) =>
      (account.data.sign_ins as { link_kind: string }[]).map((sign_in) => sign_in.link_kind);
    expect(kinds(of_member)).toEqual(['new_link', 'invitation']);
    expect(kinds(of_owner)).toEqual(['command_line', 'command_line']);
    expect((await arrival_of(owner.user_id)).sign_in_notice).toMatchObject({
      made_by_name: 'the command line of this server',
    });
  });

  it('may be made by an owner only, while an admin still invites and re-invites', async () => {
    const owner = await sign_the_owner_in();
    const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const not_joined = await invite(admin.user_id, 'Not here yet', 'member');

    const for_joined = await call(
      'POST',
      `/v1/team/members/${member.user_id}/sign-in-link`,
      as_person(admin.user_id),
    );
    expect(for_joined.status).toBe(403);
    await new_link_for(admin.user_id, not_joined.user_id);
    await new_link_for(owner.user_id, member.user_id);
  });
});

describe('sign out everywhere', () => {
  it('ends every session of the person who asks, and of nobody else', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const signed_out = await call(
      'POST',
      '/v1/team/sign-out-everywhere',
      as_person(member.user_id),
    );
    expect(signed_out.status).toBe(200);
    expect(await session_status(member.session_token)).toBe(401);
    expect(await session_status(owner.session_token)).toBe(200);
  });
});
