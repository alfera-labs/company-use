import {
  as_person,
  call,
  db,
  invite,
  invite_and_join,
  sign_in,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { connections, resource_grants, team_sign_in_links } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

describe('who hands out the admin role', () => {
  it('is the owner only: an admin invites members and promotes nobody', async () => {
    const owner = await sign_the_owner_in();
    const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const as_admin = as_person(admin.user_id);

    const by_admin = [
      await call('POST', '/v1/team/invitations', as_admin, { name: 'New admin', role: 'admin' }),
      await call('PATCH', `/v1/team/members/${member.user_id}`, as_admin, { role: 'admin' }),
      await call('POST', '/v1/team/invitations', as_admin, { name: 'New owner', role: 'owner' }),
    ];
    expect(by_admin.map((attempt) => attempt.status)).toEqual([403, 403, 403]);
    expect(by_admin[0]?.error?.message).toBe(
      'Only an owner can make someone an admin or an owner.',
    );
    expect((await invite(admin.user_id, 'New member', 'member')).status).toBe(201);
    expect((await invite(owner.user_id, 'New admin', 'admin')).status).toBe(201);
    const promoted = await call(
      'PATCH',
      `/v1/team/members/${member.user_id}`,
      as_person(owner.user_id),
      {
        role: 'admin',
      },
    );
    expect(promoted.status).toBe(200);
  });
});

describe('who sets the workspace up', () => {
  it('is an owner or an admin: a member is refused on every onboarding write, and still reads', async () => {
    const owner = await sign_the_owner_in();
    const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const writes = ['profile', 'company-scan', 'step', 'complete', 'dev-skip', 'welcome'];

    for (const write of writes) {
      const by_member = await call(
        'POST',
        `/v1/onboarding/${write}`,
        as_person(member.user_id),
        {},
      );
      expect([write, by_member.status, by_member.error?.code]).toEqual([
        write,
        403,
        'team_access_denied',
      ]);
    }
    expect((await call('GET', '/v1/onboarding', as_person(member.user_id))).status).toBe(200);
    for (const person of [admin, owner]) {
      const completed = await call(
        'POST',
        '/v1/onboarding/complete',
        as_person(person.user_id),
        {},
      );
      expect(completed.status).toBe(200);
    }
  });

  it('is everybody outside team mode, as before', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const first = as_person('user_first_of_the_org');
    const second = as_person('user_second_of_the_org');
    await call('GET', '/v1/workspace', first);
    expect((await call('POST', '/v1/onboarding/complete', second, {})).status).toBe(200);
  });
});

describe('the owner link of the installer', () => {
  it('lasts as many minutes as the caller asks for, sixty at most and by default', async () => {
    const lifetime_of = async (query: string) => {
      const link = await sign_in(`owner-link${query}`, undefined);
      const [stored] = await db
        .select()
        .from(team_sign_in_links)
        .orderBy(team_sign_in_links.created_time);
      const newest = (await db.select().from(team_sign_in_links)).at(-1) ?? stored;
      return {
        status: link.status,
        minutes: Math.round(((newest?.expires_time.getTime() ?? 0) - Date.now()) / 60_000),
      };
    };
    expect(await lifetime_of('?minutes=10')).toEqual({ status: 201, minutes: 10 });
    expect(await lifetime_of('')).toEqual({ status: 201, minutes: 60 });
    expect((await lifetime_of('?minutes=600')).status).toBe(422);
    expect((await lifetime_of('?minutes=0')).status).toBe(422);
  });
});

describe('the app accounts of a person who is removed', () => {
  async function team_with_a_connected_member() {
    const owner = await sign_the_owner_in();
    const member = await invite_and_join(owner.user_id, 'Lin', 'member');
    const other = await invite_and_join(owner.user_id, 'Sam', 'member');
    const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
    const workspace_id = String(workspace.data.workspace_id);
    const audit = { created_by: member.user_id, last_updated_by: member.user_id };
    await db.insert(connections).values({
      connection_id: 'conn_of_lin',
      workspace_id,
      app_id: 'app_fixture',
      connection_key: 'conn_of_lin',
      connection_name: 'Lin mailbox',
      connection_status: 'active',
      connected_by: member.user_id,
      ...audit,
    });
    for (const grantee_id of [member.user_id, other.user_id]) {
      await db.insert(resource_grants).values({
        resource_grant_id: create_id(id_prefixes.resource_grant),
        workspace_id,
        resource_type: 'connection',
        resource_id: 'conn_of_lin',
        grantee_type: 'user',
        grantee_id,
        grant_level: 'use',
        ...audit,
      });
    }
    return { owner, member, other };
  }

  const status_of_connection = async () =>
    (await db.select().from(connections).where(eq(connections.connection_id, 'conn_of_lin')))[0]
      ?.connection_status;

  it('are shown to the remover with who else uses each, and to no member', async () => {
    const team = await team_with_a_connected_member();
    const path = `/v1/team/members/${team.member.user_id}/connections`;

    const shown = await call('GET', path, as_person(team.owner.user_id));
    expect(shown.data.connections).toEqual([
      {
        connection_id: 'conn_of_lin',
        connection_name: 'Lin mailbox',
        also_used_by_user_ids: [team.other.user_id],
      },
    ]);
    expect((await call('GET', path, as_person(team.other.user_id))).status).toBe(403);
  });

  it('are disconnected with the person unless the remover keeps them', async () => {
    const team = await team_with_a_connected_member();
    const removed = await call(
      'DELETE',
      `/v1/team/members/${team.member.user_id}`,
      as_person(team.owner.user_id),
    );

    expect(removed.data.connections).toEqual([
      expect.objectContaining({ connection_name: 'Lin mailbox', disconnected: true }),
    ]);
    expect(await status_of_connection()).toBe('revoked');
  });

  it('stay wired in when the remover asks for that, and the summary says so', async () => {
    const team = await team_with_a_connected_member();
    const removed = await call(
      'DELETE',
      `/v1/team/members/${team.member.user_id}?keep_connections=true`,
      as_person(team.owner.user_id),
    );

    expect(removed.data.connections).toEqual([
      expect.objectContaining({ connection_name: 'Lin mailbox', disconnected: false }),
    ]);
    expect(await status_of_connection()).toBe('active');
  });
});
