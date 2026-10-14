import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { validate_api_startup_config } from '@api/lib/startup_config';
import {
  as_person,
  call,
  db,
  invite,
  invite_and_join,
  join_with,
  machine,
  sign_in,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { hash_team_secret } from '@api/services/team/team_secrets';
import { team_sessions, team_sign_in_links, workspace_members } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

describe('an install that is not in team mode', () => {
  it('answers a team address exactly as an address with no route, for any caller', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const { [proxy_auth_headers.secret]: _secret, ...no_secret } = as_person('user_1');
    for (const headers of [as_person('user_1'), no_secret, machine]) {
      const no_route = await call('GET', '/v1/an-address-with-no-route', headers);
      for (const [method, path] of [
        ['GET', '/v1/team'],
        ['DELETE', '/v1/team/members/user_1'],
        ['POST', '/v1/team-sign-in/owner-link'],
      ] as const) {
        expect(await call(method, path, headers)).toEqual(no_route);
      }
    }
  });

  it('has no team routes for any other value of the switch, and makes no link', async () => {
    for (const mode of ['', 'local', 'workos', 'Team', 'team ']) {
      vi.stubEnv('COWORKER_AUTH_MODE', mode);
      const machine_answers = [
        await sign_in('owner-link', undefined),
        await sign_in('link/redeem', { token: 'a'.repeat(43) }),
        await sign_in('session', { session_token: 'a'.repeat(43) }),
      ];
      expect(machine_answers.map((answer) => answer.status)).toEqual([401, 401, 401]);
      expect((await call('GET', '/v1/team', as_person('user_1'))).status).toBe(404);
      const invited = await call('POST', '/v1/team/invitations', as_person('user_1'), {
        name: 'Ada',
        role: 'owner',
      });
      expect(invited.status).toBe(404);
    }
    expect(await db.select().from(team_sign_in_links)).toEqual([]);
    expect(await db.select().from(team_sessions)).toEqual([]);
  });

  it('still makes a person from the sign-in provider identity, as before', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const headers = {
      ...as_person('user_from_provider'),
      [proxy_auth_headers.organization_id]: 'org_from_provider',
      [proxy_auth_headers.email]: 'founder@example.com',
    };
    expect((await call('GET', '/v1/workspace', headers)).status).toBe(200);
    expect((await call('GET', '/v1/workspace/members', headers)).status).toBe(200);
    expect((await call('GET', '/v1/auth/workspace-invitations', headers)).status).not.toBe(404);
  });

  it('starts with the provider keys set, and refuses to start when team mode is set beside them', () => {
    const config = {
      NODE_ENV: 'development' as const,
      EVENT_JOB_DISPATCH_MODE: 'rivet' as const,
      RIVET_ENDPOINT: 'http://127.0.0.1:6420',
      COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'docker' as const,
      COWORKER_PERSISTENT_WORKSPACES_ENABLED: false,
      COWORKER_API_PROXY_SECRET: 'a'.repeat(64),
    };
    vi.stubEnv('WORKOS_API_KEY', 'a_provider_key');
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    expect(() => validate_api_startup_config(config)).not.toThrow();
    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    expect(() => validate_api_startup_config(config)).toThrow(/WORKOS_API_KEY is set/);
    vi.stubEnv('WORKOS_API_KEY', '');
    vi.stubEnv('WORKOS_CLIENT_ID', 'a_client_id');
    expect(() => validate_api_startup_config(config)).toThrow(/WORKOS_CLIENT_ID is set/);
    vi.stubEnv('WORKOS_CLIENT_ID', '');
    expect(() => validate_api_startup_config(config)).not.toThrow();
  });
});

describe('the proxy secret of a team-mode install', () => {
  const config = {
    NODE_ENV: 'development' as const,
    EVENT_JOB_DISPATCH_MODE: 'rivet' as const,
    RIVET_ENDPOINT: 'http://127.0.0.1:6420',
    COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'docker' as const,
    COWORKER_PERSISTENT_WORKSPACES_ENABLED: false,
  };
  const start_with = (secret: string | undefined) => () =>
    validate_api_startup_config({ ...config, COWORKER_API_PROXY_SECRET: secret });

  it('must be set, be the install own, and be 32 characters or more, or the API does not start', () => {
    const weak_secrets = [
      undefined,
      '',
      '   ',
      'local-development-internal-api-secret',
      'short-secret',
      'x'.repeat(31),
    ];
    for (const secret of weak_secrets) {
      expect(start_with(secret), String(secret)).toThrow(/COWORKER_API_PROXY_SECRET/);
    }
    expect(start_with('x'.repeat(32))).not.toThrow();
    expect(start_with('f'.repeat(64))).not.toThrow();
  });

  it('is not asked of an install outside team mode, which starts as it did', () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    for (const secret of [undefined, 'local-development-internal-api-secret', 'short']) {
      expect(start_with(secret)).not.toThrow();
    }
  });
});

describe('a sign-in link', () => {
  it('keeps the workspace and the person local mode made, and makes them the owner', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', 'local');
    const local = {
      ...as_person('user_local'),
      [proxy_auth_headers.first_name]: 'Ada',
    };
    const before = await call('GET', '/v1/workspace', local);
    expect(before.status).toBe(200);

    vi.stubEnv('COWORKER_AUTH_MODE', 'team');
    const owner = await sign_the_owner_in();
    const after = await call('GET', '/v1/workspace', as_person(owner.user_id));
    expect(owner.user_id).toBe(before.data.viewer_user_id);
    expect(after.data.workspace_id).toBe(before.data.workspace_id);
    const team = await call('GET', '/v1/team', as_person(owner.user_id));
    expect(team.data).toMatchObject({
      viewer_role: 'owner',
      members: [{ user_id: owner.user_id, first_name: 'Ada', member_role: 'owner' }],
    });
  });

  it('stores only hashes of the link and of the session', async () => {
    const link = await sign_in('owner-link', undefined);
    const token = link.data.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { session_token } = await join_with(token);

    const [link_row] = await db.select().from(team_sign_in_links);
    const [session_row] = await db.select().from(team_sessions);
    expect(link_row?.token_hash).toBe(hash_team_secret(token));
    expect(session_row?.session_hash).toBe(hash_team_secret(session_token));
    expect(JSON.stringify([link_row, session_row])).not.toContain(token);
    expect(JSON.stringify([link_row, session_row])).not.toContain(session_token);
  });

  it('is not used up by a look, and works exactly once', async () => {
    const owner = await sign_the_owner_in();
    const invited = await invite(owner.user_id, 'Grace <b>', 'member');

    for (let look = 0; look < 3; look += 1) {
      const preview = await sign_in('link/preview', { token: invited.token });
      expect(preview.status).toBe(200);
      expect(preview.data.person_name).toBe('Grace <b>');
      expect(preview.data.has_joined_before).toBe(false);
    }
    const [first, second] = await Promise.all([
      sign_in('link/redeem', { token: invited.token }),
      sign_in('link/redeem', { token: invited.token }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 404]);
    expect((await sign_in('link/redeem', { token: invited.token })).status).toBe(404);
    expect((await sign_in('link/preview', { token: invited.token })).status).toBe(404);
  });

  it('gives one answer for a wrong, a used, an expired and a removed link', async () => {
    const owner = await sign_the_owner_in();
    const used = await invite_and_join(owner.user_id, 'Used', 'member');
    const expired = await invite(owner.user_id, 'Expired', 'member');
    await db
      .update(team_sign_in_links)
      .set({ expires_time: new Date(Date.now() - 1000) })
      .where(eq(team_sign_in_links.token_hash, hash_team_secret(expired.token)));
    const removed = await invite(owner.user_id, 'Removed', 'member');
    await call('DELETE', `/v1/team/members/${removed.user_id}`, as_person(owner.user_id));

    const answers = [];
    for (const token of ['z'.repeat(43), used.token, expired.token, removed.token]) {
      for (const path of ['link/preview', 'link/redeem']) {
        const answer = await sign_in(path, { token });
        answers.push(`${answer.status} ${answer.error?.code} ${answer.error?.message}`);
      }
    }
    expect(new Set(answers)).toEqual(
      new Set(['404 team_link_not_valid This link is not valid any more']),
    );
    expect((await sign_in('link/redeem', { token: 'short' })).status).toBe(422);
  });

  it('lasts two days for an invitation and one hour for a member', async () => {
    const owner = await sign_the_owner_in();
    const invited = await call('POST', '/v1/team/invitations', as_person(owner.user_id), {
      name: 'Lin',
      role: 'member',
    });
    const invitation_link = invited.data.sign_in_link as { token: string; expires_time: string };
    const member_user_id = (invited.data.member as { user_id: string }).user_id;
    const day = 24 * 60 * 60 * 1000;
    expect(Date.parse(invitation_link.expires_time) - Date.now()).toBeGreaterThan(2 * day - 60_000);
    expect(Date.parse(invitation_link.expires_time) - Date.now()).toBeLessThanOrEqual(2 * day);

    await join_with(invitation_link.token);
    const member_link = await call(
      'POST',
      `/v1/team/members/${member_user_id}/sign-in-link`,
      as_person(owner.user_id),
    );
    const lifetime = Date.parse(member_link.data.expires_time as string) - Date.now();
    expect(lifetime).toBeGreaterThan(59 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(60 * 60_000);
  });

  it('ends the earlier unused link of the same person when a new one is made', async () => {
    const owner = await sign_the_owner_in();
    const invited = await invite(owner.user_id, 'Lin', 'member');
    const newer = await call(
      'POST',
      `/v1/team/members/${invited.user_id}/sign-in-link`,
      as_person(owner.user_id),
    );
    expect((await sign_in('link/redeem', { token: invited.token })).status).toBe(404);
    expect((await sign_in('link/redeem', { token: newer.data.token })).status).toBe(201);
  });
});

describe('a session', () => {
  it('ends at sign-out, and a copy of the token signs nobody in', async () => {
    const owner = await sign_the_owner_in();
    expect((await sign_in('session/end', { session_token: owner.session_token })).status).toBe(200);
    expect((await sign_in('session', { session_token: owner.session_token })).status).toBe(401);
  });

  it('has an absolute end 30 days after it starts, and using it does not move the end', async () => {
    const owner = await sign_the_owner_in();
    const day = 24 * 60 * 60 * 1000;
    const [made] = await db.select().from(team_sessions);
    const end = made?.expires_time.getTime() ?? 0;
    expect(end - Date.now()).toBeGreaterThan(30 * day - 60_000);
    expect(end - Date.now()).toBeLessThanOrEqual(30 * day);

    const in_two_days = new Date(Date.now() + 2 * day);
    await db.update(team_sessions).set({ expires_time: in_two_days });
    for (let use = 0; use < 3; use += 1) {
      expect((await sign_in('session', { session_token: owner.session_token })).status).toBe(200);
    }
    const [used] = await db.select().from(team_sessions);
    expect(used?.expires_time.getTime()).toBe(in_two_days.getTime());

    await db.update(team_sessions).set({ expires_time: new Date(Date.now() - 1000) });
    expect((await sign_in('session', { session_token: owner.session_token })).status).toBe(401);
  });

  it('is a different person for each member, each with a seat of their own', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    expect(member.user_id).not.toBe(owner.user_id);
    const as_member = await call('GET', '/v1/workspace', as_person(member.user_id));
    const as_owner = await call('GET', '/v1/workspace', as_person(owner.user_id));
    expect(as_member.data.viewer_user_id).toBe(member.user_id);
    expect(as_member.data.workspace_id).toBe(as_owner.data.workspace_id);
  });
});

describe('who the API believes', () => {
  it('believes nobody without the proxy secret, whatever the identity headers say', async () => {
    const owner = await sign_the_owner_in();
    const { [proxy_auth_headers.secret]: _secret, ...forged } = as_person(owner.user_id);
    const wrong_secret = { ...forged, [proxy_auth_headers.secret]: 'not-the-secret' };
    for (const headers of [forged, wrong_secret]) {
      expect((await call('GET', '/v1/team', headers)).status).toBe(401);
      expect((await call('GET', '/v1/sessions', headers)).status).toBe(401);
      expect(
        (await call('POST', '/v1/team/invitations', headers, { name: 'Eve', role: 'owner' }))
          .status,
      ).toBe(401);
      expect((await call('POST', '/v1/team-sign-in/owner-link', headers)).status).toBe(401);
    }
  });

  it('refuses a machine route to a caller that names a person', async () => {
    const owner = await sign_the_owner_in();
    const answer = await call('POST', '/v1/team-sign-in/owner-link', as_person(owner.user_id));
    expect(answer.status).toBe(403);
  });

  it('makes no person from a request: an unknown or an invited id gets nothing', async () => {
    const owner = await sign_the_owner_in();
    const invited = await invite(owner.user_id, 'Not yet here', 'admin');
    for (const user_id of ['user_local', 'user_999999', invited.user_id]) {
      expect((await call('GET', '/v1/workspace', as_person(user_id))).status).toBe(401);
    }
    const team = await call('GET', '/v1/team', as_person(owner.user_id));
    expect(team.data.members).toHaveLength(2);
  });

  it('closes the routes that manage people through the sign-in provider', async () => {
    const owner = await sign_the_owner_in();
    const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
    const as_admin = as_person(admin.user_id);
    const demote_owner = await call('PATCH', `/v1/workspace/members/${owner.user_id}`, as_admin, {
      role: 'member',
    });
    expect(demote_owner.status).toBe(404);
    expect((await call('GET', '/v1/workspace/invitations', as_admin)).status).toBe(404);
    expect(
      (
        await call('POST', '/v1/workspace/invitations', as_admin, {
          email: 'eve@example.com',
          role: 'admin',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('POST', '/v1/auth/workspace', machine, {
          provider_key: 'workos',
          provider_user_id: 'user_eve',
          organization_id: 'org_local',
        })
      ).status,
    ).toBe(404);
    const team = await call('GET', '/v1/team', as_person(owner.user_id));
    expect(team.data.members).toHaveLength(2);
    expect((team.data.members as { member_role: string }[])[0]?.member_role).toBe('owner');
  });
});

describe('who may manage the team', () => {
  it('refuses a member on every owner and admin route', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const other = await invite_and_join(owner.user_id, 'Sam', 'member');
    const as_member = as_person(member.user_id);

    const attempts = [
      await call('POST', '/v1/team/invitations', as_member, { name: 'Eve', role: 'member' }),
      await call('POST', `/v1/team/members/${owner.user_id}/sign-in-link`, as_member),
      await call('POST', `/v1/team/members/${other.user_id}/sign-in-link`, as_member),
      await call('POST', `/v1/team/members/${member.user_id}/sign-in-link`, as_member),
      await call('PATCH', `/v1/team/members/${member.user_id}`, as_member, { role: 'owner' }),
      await call('PATCH', `/v1/team/members/${owner.user_id}`, as_member, { role: 'member' }),
      await call('DELETE', `/v1/team/members/${other.user_id}`, as_member),
      await call('DELETE', `/v1/team/members/${owner.user_id}`, as_member),
    ];
    expect(attempts.map((attempt) => attempt.status)).toEqual(attempts.map(() => 403));
    expect(attempts.every((attempt) => attempt.error?.code === 'team_access_denied')).toBe(true);
    expect(await db.select().from(team_sign_in_links)).toHaveLength(3);
    expect((await call('GET', '/v1/team', as_member)).data.members).toHaveLength(3);
  });

  it('lets an admin invite and remove members, and stops an admin from becoming an owner', async () => {
    const owner = await sign_the_owner_in();
    const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
    const peer = await invite_and_join(owner.user_id, 'Peer', 'admin');
    const as_admin = as_person(admin.user_id);

    const member = await invite(admin.user_id, 'Lin', 'member');
    expect(member.status).toBe(201);
    const link_before_joining = await call(
      'POST',
      `/v1/team/members/${member.user_id}/sign-in-link`,
      as_admin,
    );
    expect(link_before_joining.status).toBe(201);
    await join_with(String(link_before_joining.data.token));
    const link_after_joining = await call(
      'POST',
      `/v1/team/members/${member.user_id}/sign-in-link`,
      as_admin,
    );
    expect([link_after_joining.status, link_after_joining.error?.message]).toEqual([
      403,
      'Only an owner can make a sign-in link for a person who has already joined.',
    ]);

    const refused = [
      await call('POST', '/v1/team/invitations', as_admin, { name: 'Eve', role: 'owner' }),
      await call('POST', `/v1/team/members/${owner.user_id}/sign-in-link`, as_admin),
      await call('POST', `/v1/team/members/${peer.user_id}/sign-in-link`, as_admin),
      await call('PATCH', `/v1/team/members/${admin.user_id}`, as_admin, { role: 'owner' }),
      await call('PATCH', `/v1/team/members/${owner.user_id}`, as_admin, { role: 'admin' }),
      await call('DELETE', `/v1/team/members/${owner.user_id}`, as_admin),
      await call('DELETE', `/v1/team/members/${peer.user_id}`, as_admin),
    ];
    expect(refused.map((attempt) => attempt.status)).toEqual(refused.map(() => 403));
    expect((await call('DELETE', `/v1/team/members/${member.user_id}`, as_admin)).status).toBe(200);
  });

  it('keeps the last owner: no removal, no demotion, until there is a second owner', async () => {
    const owner = await sign_the_owner_in();
    const as_owner = as_person(owner.user_id);
    const second = await invite(owner.user_id, 'Second', 'owner');

    const while_alone = [
      await call('DELETE', `/v1/team/members/${owner.user_id}`, as_owner),
      await call('PATCH', `/v1/team/members/${owner.user_id}`, as_owner, { role: 'admin' }),
    ];
    expect(while_alone.map((attempt) => attempt.status)).toEqual([409, 409]);

    const joined = await join_with(second.token);
    const demoted = await call('PATCH', `/v1/team/members/${owner.user_id}`, as_owner, {
      role: 'member',
    });
    expect(demoted.status).toBe(200);
    const as_second = as_person(joined.user_id);
    expect((await call('DELETE', `/v1/team/members/${joined.user_id}`, as_second)).status).toBe(
      409,
    );
    expect(
      (await call('PATCH', `/v1/team/members/${joined.user_id}`, as_second, { role: 'admin' }))
        .status,
    ).toBe(409);
  });

  it('puts a removed person out at once: seat, sessions and unused links', async () => {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const spare_link = await call(
      'POST',
      `/v1/team/members/${member.user_id}/sign-in-link`,
      as_person(owner.user_id),
    );
    expect(
      (await call('DELETE', `/v1/team/members/${member.user_id}`, as_person(owner.user_id))).status,
    ).toBe(200);

    expect((await sign_in('session', { session_token: member.session_token })).status).toBe(401);
    expect((await sign_in('link/redeem', { token: spare_link.data.token })).status).toBe(404);
    expect((await call('GET', '/v1/workspace', as_person(member.user_id))).status).toBe(401);
    const [seat] = await db
      .select()
      .from(workspace_members)
      .where(eq(workspace_members.user_id, member.user_id));
    expect(seat?.member_status).toBe('inactive');
    expect(
      (await call('DELETE', `/v1/team/members/${member.user_id}`, as_person(owner.user_id))).status,
    ).toBe(404);
  });
});
