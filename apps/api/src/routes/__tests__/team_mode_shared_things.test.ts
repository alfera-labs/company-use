import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { insert_workspace_credential } from '@coworker/core/db/queries/connection_credentials';
import { find_personal_project } from '@coworker/core/db/queries/personal_projects';
import { create_session, get_agent } from '@coworker/core/db/queries/sessions';
import { runtime_set_agent_name_tool } from '@runtime-platform/tools/definitions/runtime_set_agent_name';
import { email_create_address_tool } from '@runtime-platform/tools/email/create_address';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

use_a_fresh_team_install();

type Team = Awaited<ReturnType<typeof owner_admin_and_member>>;

async function owner_admin_and_member() {
  const owner = await sign_the_owner_in();
  const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
  const member = await invite_and_join(owner.user_id, 'Ada', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  return {
    owner,
    admin,
    member,
    workspace_id: String(workspace.data.workspace_id),
    agent_id: await main_agent_id(as_person(owner.user_id)),
  };
}

function run_of(team: Team, user_id: string) {
  return {
    db,
    workspace_id: team.workspace_id,
    agent_id: team.agent_id,
    session_id: 'ses_test',
    run_id: 'run_test',
    actor_id: user_id,
  };
}

async function credential_of(team: Team, user_id: string, display_name: string) {
  const made = await insert_workspace_credential(db, {
    workspace_id: team.workspace_id,
    created_by: user_id,
    display_name,
    allowed_hosts: ['api.example.com'],
    secret_values: { api_key: 'a-secret-value' },
    add_to_every_request: [],
  });
  return made.connection_id;
}

const credential_list_schema = z.array(z.object({ connection_id: z.string() }));

async function credentials_listed_for(user_id: string): Promise<string[]> {
  const listed = await call('GET', '/v1/connection-credentials', as_person(user_id));
  expect(listed.status).toBe(200);
  const credentials = credential_list_schema.parse(listed.data.credentials);
  return credentials.map((credential) => credential.connection_id).sort();
}

describe('what the whole team shares, in team mode', () => {
  it('lets the coworker of an owner or an admin rename the coworker, and not the coworker of a member', async () => {
    const team = await owner_admin_and_member();
    const rename = (user_id: string, agent_name: string) =>
      runtime_set_agent_name_tool.execute({ agent_name }, run_of(team, user_id));

    const by_member = await rename(team.member.user_id, 'Taken over');
    expect(by_member).toMatchObject({ success: false, error: { code: 'team_access_denied' } });
    expect((await get_agent(db, team.workspace_id, team.agent_id))?.agent_name).not.toBe(
      'Taken over',
    );
    expect(await rename('system:trigger', 'Taken over')).toMatchObject({ success: false });
    expect(await rename(team.admin.user_id, 'Robin')).toMatchObject({ success: true });
    expect((await get_agent(db, team.workspace_id, team.agent_id))?.agent_name).toBe('Robin');

    vi.stubEnv('COWORKER_AUTH_MODE', '');
    expect(await rename(team.member.user_id, 'As before')).toMatchObject({ success: true });
  });

  it('keeps the address the team gets mail at to an owner or an admin, by route and by tool', async () => {
    const team = await owner_admin_and_member();
    const path = '/v1/workspace/email-address';
    const switch_off = { enabled: false };

    expect((await call('PATCH', path, as_person(team.member.user_id), switch_off)).status).toBe(
      403,
    );
    expect((await call('POST', path, as_person(team.member.user_id), {})).status).toBe(403);
    expect((await call('GET', path, as_person(team.member.user_id))).status).toBe(200);
    expect((await call('PATCH', path, as_person(team.admin.user_id), switch_off)).status).not.toBe(
      403,
    );
    const by_tool = await email_create_address_tool.execute({}, run_of(team, team.member.user_id));
    expect(by_tool).toMatchObject({ success: false, error: { code: 'team_access_denied' } });
  });

  it('shows a member only the stored credentials they made, and an owner or an admin every one', async () => {
    const team = await owner_admin_and_member();
    const of_owner = await credential_of(team, team.owner.user_id, 'Owner key');
    const of_member = await credential_of(team, team.member.user_id, 'Member key');

    expect(await credentials_listed_for(team.member.user_id)).toEqual([of_member]);
    expect(await credentials_listed_for(team.admin.user_id)).toEqual([of_owner, of_member].sort());
    expect(await credentials_listed_for(team.owner.user_id)).toEqual([of_owner, of_member].sort());
  });

  it('answers "not found" to a member who switches off or renews another person credential', async () => {
    const team = await owner_admin_and_member();
    const of_owner = await credential_of(team, team.owner.user_id, 'Owner key');
    const of_member = await credential_of(team, team.member.user_id, 'Member key');
    const as_member = as_person(team.member.user_id);
    const path = (connection_id: string) => `/v1/connection-credentials/${connection_id}`;

    expect((await call('DELETE', path(of_owner), as_member)).status).toBe(404);
    expect((await call('POST', `${path(of_owner)}/exchange`, as_member)).status).toBe(404);
    expect((await call('GET', `/v1/app-sign-in/${of_owner}`, as_member)).status).toBe(404);
    expect(await credentials_listed_for(team.owner.user_id)).toEqual([of_owner, of_member].sort());
    expect((await call('DELETE', path(of_member), as_member)).status).toBe(200);
    expect((await call('DELETE', path(of_owner), as_person(team.admin.user_id))).status).toBe(200);
    expect(await credentials_listed_for(team.owner.user_id)).toEqual([]);
  });

  it('lets only its maker, an owner or an admin move a chat out of a shared place', async () => {
    const team = await owner_admin_and_member();
    const mail_from_outside = await create_session(db, {
      workspace_id: team.workspace_id,
      agent_id: team.agent_id,
      source_type: 'email',
      session_source: 'email',
      actor_id: 'system:email',
    });
    const room_of = async (user_id: string) =>
      (await find_personal_project(db, { workspace_id: team.workspace_id, user_id }))?.project_id;
    const move = async (user_id: string) =>
      call('PATCH', `/v1/sessions/${mail_from_outside.session_id}`, as_person(user_id), {
        project_id: await room_of(user_id),
      });
    const opens = async (user_id: string) =>
      (await call('GET', `/v1/sessions/${mail_from_outside.session_id}`, as_person(user_id)))
        .status;

    expect((await move(team.member.user_id)).status).toBe(403);
    expect(await opens(team.admin.user_id)).toBe(200);
    expect((await move(team.admin.user_id)).status).toBe(200);
    expect(await opens(team.member.user_id)).toBe(404);

    const own_chat = await call('POST', '/v1/sessions', as_person(team.member.user_id), {});
    const out_of_every_room = await call(
      'PATCH',
      `/v1/sessions/${String(own_chat.data.session_id)}`,
      as_person(team.member.user_id),
      { project_id: null },
    );
    expect(out_of_every_room.status).toBe(200);
  });
});
