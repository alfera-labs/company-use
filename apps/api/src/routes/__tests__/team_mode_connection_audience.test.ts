import {
  as_person,
  call,
  db,
  invite_and_join,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { insert_workspace_credential } from '@coworker/core/db/queries/connection_credentials';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

async function team_with_a_connection_of_the_owner() {
  const owner = await sign_the_owner_in();
  const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
  const member = await invite_and_join(owner.user_id, 'Ada', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  const made = await insert_workspace_credential(db, {
    workspace_id: String(workspace.data.workspace_id),
    created_by: owner.user_id,
    display_name: 'Owner key',
    allowed_hosts: ['api.example.com'],
    secret_values: { api_key: 'a-secret-value' },
    add_to_every_request: [],
  });
  return { owner, admin, member, audience_path: `/v1/access/connection/${made.connection_id}` };
}

const only = (user_id: string) => ({
  shared_with_everyone_in_the_workspace: false,
  shared_with: [{ person: user_id, can: 'use' }],
});

describe('who changes "who can use" on a connection another person made', () => {
  it('lets a member read it and refuses every change she tries', async () => {
    const team = await team_with_a_connection_of_the_owner();
    const as_member = as_person(team.member.user_id);
    const me = team.member.user_id;

    const taken = await call('PUT', team.audience_path, as_member, only(me));
    const added = await call('POST', `${team.audience_path}/grantees`, as_member, { person: me });
    const read = await call('GET', team.audience_path, as_member);

    expect(taken.status).toBe(403);
    expect(added.status).toBe(403);
    expect(read.status).toBe(200);
    expect(read.data.shared_with_everyone_in_the_workspace).toBe(true);
  });

  it('lets the person who made it, and an admin, change it', async () => {
    const team = await team_with_a_connection_of_the_owner();
    const by = (user_id: string) =>
      call('PUT', team.audience_path, as_person(user_id), only(team.owner.user_id));

    expect((await by(team.owner.user_id)).status).toBe(200);
    expect((await by(team.admin.user_id)).status).toBe(200);
  });

  it('refuses a removed member', async () => {
    const team = await team_with_a_connection_of_the_owner();
    const removal = `/v1/team/members/${team.member.user_id}`;
    expect((await call('DELETE', removal, as_person(team.owner.user_id))).status).toBe(200);

    const taken = await call(
      'PUT',
      team.audience_path,
      as_person(team.member.user_id),
      only(team.member.user_id),
    );
    const read = await call('GET', team.audience_path, as_person(team.owner.user_id));

    expect(taken.status).toBeGreaterThanOrEqual(400);
    expect(read.data.shared_with_everyone_in_the_workspace).toBe(true);
  });

  it('refuses a member outside team mode too, as before', async () => {
    const team = await team_with_a_connection_of_the_owner();
    vi.stubEnv('COWORKER_AUTH_MODE', '');

    const taken = await call(
      'PUT',
      team.audience_path,
      as_person(team.member.user_id),
      only(team.member.user_id),
    );

    expect(taken.status).toBe(403);
  });
});
