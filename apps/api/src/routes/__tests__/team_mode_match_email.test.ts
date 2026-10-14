import {
  as_person,
  call,
  db,
  invite,
  invite_and_join,
  join_with,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { list_members_to_match_by_email } from '@coworker/core/db/queries/team_match_emails';
import { find_active_workspace_member_by_email } from '@coworker/core/db/queries/workspace_member_by_email';
import { read_slack_speaker } from '@runtime-platform/channels/slack/slack_speaker';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

async function owner_and_workspace() {
  const owner = await sign_the_owner_in();
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  return { owner, workspace_id: String(workspace.data.workspace_id) };
}

const own_email = (user_id: string, match_email: string | null) =>
  call('PATCH', '/v1/team/me', as_person(user_id), { match_email });

function slack_message_from(email: string | undefined) {
  return {
    team_id: 'T1',
    user_id: 'U1',
    channel_id: 'D1',
    user_profile: email ? { email } : undefined,
  } as Parameters<typeof read_slack_speaker>[1]['message'];
}

describe('the address a person of a team install is known by in Slack and in mail', () => {
  it('is given at the invitation by an owner, and matches a Slack speaker once the person joined', async () => {
    const { owner, workspace_id } = await owner_and_workspace();
    const invited = await call('POST', '/v1/team/invitations', as_person(owner.user_id), {
      name: 'Ada',
      role: 'member',
      email: 'Ada@Example.com',
    });
    expect(invited.status).toBe(201);
    const ada_id = String((invited.data.member as { user_id: string }).user_id);
    const speaker = () =>
      read_slack_speaker(
        db,
        { workspace_id, message: slack_message_from('ada@example.com') },
        { spoke_to_the_agent: true },
      );

    expect(await speaker()).toMatchObject({ refusal: { code: 'slack_speaker_is_not_a_member' } });
    await join_with(String((invited.data.sign_in_link as { token: string }).token));

    expect(await speaker()).toMatchObject({ member_user_id: ada_id });
  });

  it('refuses a Slack speaker whose email is no member address, as before', async () => {
    const { owner, workspace_id } = await owner_and_workspace();
    await own_email(owner.user_id, 'owner@example.com');

    const stranger = await read_slack_speaker(
      db,
      { workspace_id, message: slack_message_from('stranger@example.com') },
      { spoke_to_the_agent: true },
    );
    const nobody = await read_slack_speaker(
      db,
      { workspace_id, message: slack_message_from(undefined) },
      { spoke_to_the_agent: true },
    );

    expect(stranger).toMatchObject({ refusal: { code: 'slack_speaker_is_not_a_member' } });
    expect(JSON.stringify(stranger)).toContain('Settings, then Profile');
    expect(nobody).toMatchObject({ refusal: { code: 'slack_speaker_is_unknown' } });
  });

  it('is set, changed and cleared by the person, for themself only', async () => {
    const { owner, workspace_id } = await owner_and_workspace();
    const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
    const find = (email: string) =>
      find_active_workspace_member_by_email(db, { workspace_id, email });

    expect((await own_email(ada.user_id, ' Ada@Example.com ')).data.match_email).toBe(
      'ada@example.com',
    );
    expect(await find('ADA@example.com')).toBe(ada.user_id);
    expect((await call('GET', '/v1/team/me', as_person(ada.user_id))).data.match_email).toBe(
      'ada@example.com',
    );
    expect(
      (await call('GET', '/v1/team/me', as_person(owner.user_id))).data.match_email,
    ).toBeNull();

    expect((await own_email(ada.user_id, 'ada@work.example')).status).toBe(200);
    expect(await find('ada@example.com')).toBeNull();
    expect(await find('ada@work.example')).toBe(ada.user_id);

    expect((await own_email(ada.user_id, null)).status).toBe(200);
    expect(await find('ada@work.example')).toBeNull();
    expect((await own_email(ada.user_id, 'not an address')).status).toBe(422);
  });

  it('is one person only in a workspace', async () => {
    const { owner } = await owner_and_workspace();
    const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
    await own_email(ada.user_id, 'shared@example.com');

    expect((await own_email(owner.user_id, 'Shared@example.com')).status).toBe(409);
    const second = await call('POST', '/v1/team/invitations', as_person(owner.user_id), {
      name: 'Ben',
      role: 'member',
      email: 'shared@example.com',
    });
    expect(second.status).toBe(409);
    expect((await invite(owner.user_id, 'Ben', 'member')).status).toBe(201);
  });

  it('is the address a mail sender is matched by, and a person with none is matched by nothing', async () => {
    const { owner, workspace_id } = await owner_and_workspace();
    const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
    await own_email(ada.user_id, 'ada@example.com');

    const matched = await list_members_to_match_by_email(db, workspace_id);

    expect(matched.map((member) => [member.user_id, member.email])).toEqual([
      [ada.user_id, 'ada@example.com'],
    ]);
  });

  it('matches nobody outside team mode, where a person is known by the address they sign in with', async () => {
    const { owner, workspace_id } = await owner_and_workspace();
    await own_email(owner.user_id, 'owner@example.com');
    vi.stubEnv('COWORKER_AUTH_MODE', '');

    expect(
      await find_active_workspace_member_by_email(db, { workspace_id, email: 'owner@example.com' }),
    ).toBeNull();
    const matched = await list_members_to_match_by_email(db, workspace_id);
    expect(matched.map((member) => member.email)).not.toContain('owner@example.com');
  });
});
