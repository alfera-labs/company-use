import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { create_api_key } from '@coworker/core/db/queries/api_keys';
import { find_personal_project } from '@coworker/core/db/queries/personal_projects';
import { create_session } from '@coworker/core/db/queries/sessions';
import { open_automation_run_chat } from '@runtime-platform/automations/automation_run_chat';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

async function owner_and_two_members() {
  const owner = await sign_the_owner_in();
  const ada = await invite_and_join(owner.user_id, 'Ada', 'member');
  const ben = await invite_and_join(owner.user_id, 'Ben', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  return {
    owner,
    ada,
    ben,
    workspace_id: String(workspace.data.workspace_id),
    agent_id: await main_agent_id(as_person(owner.user_id)),
  };
}

type Team = Awaited<ReturnType<typeof owner_and_two_members>>;

function run_chat_of(team: Team, created_by: string, session_key = 'automation:atm_1:subject:1') {
  return open_automation_run_chat(
    db,
    {
      workspace_id: team.workspace_id,
      agent_id: team.agent_id,
      automation_name: 'Morning report',
      created_by,
    },
    { session_key, source_metadata: { automation_id: 'atm_1' }, actor_id: 'system:trigger' },
  );
}

const opens = async (user_id: string, session_id: string) =>
  (await call('GET', `/v1/sessions/${session_id}`, as_person(user_id))).status;

const reads_messages = async (user_id: string, session_id: string) =>
  (await call('GET', `/v1/sessions/${session_id}/messages`, as_person(user_id))).status;

describe('who opens the chat of an automation run in team mode', () => {
  it('opens for the person who made the automation, and for nobody else, the owner included', async () => {
    const team = await owner_and_two_members();

    const chat = await run_chat_of(team, team.ada.user_id);

    expect(await opens(team.ada.user_id, chat.session_id)).toBe(200);
    expect(await reads_messages(team.ada.user_id, chat.session_id)).toBe(200);
    for (const other of [team.owner, team.ben]) {
      expect(await opens(other.user_id, chat.session_id)).toBe(404);
      expect(await reads_messages(other.user_id, chat.session_id)).toBe(404);
    }
  });

  it('opens for the person behind the API key that made the automation', async () => {
    const team = await owner_and_two_members();
    const { api_key } = await create_api_key(db, {
      workspace_id: team.workspace_id,
      key_name: 'A key',
      scopes: ['automations.write'],
      key_audience: 'internal',
      environment_label: 'live',
      actor_id: team.owner.user_id,
    });

    const chat = await run_chat_of(team, api_key.api_key_id);

    expect(await opens(team.owner.user_id, chat.session_id)).toBe(200);
    expect(await opens(team.ada.user_id, chat.session_id)).toBe(404);
  });

  it('moves a run chat that was in no room to the room of the maker when that chat runs again', async () => {
    const team = await owner_and_two_members();
    const old_chat = await create_session(db, {
      workspace_id: team.workspace_id,
      agent_id: team.agent_id,
      source_type: 'trigger',
      session_source: 'trigger',
      external_thread_key: 'automation:atm_1:subject:old',
      actor_id: 'system:trigger',
    });
    expect(await opens(team.ada.user_id, old_chat.session_id)).toBe(404);

    const chat = await run_chat_of(team, team.ada.user_id, 'automation:atm_1:subject:old');
    const room = await find_personal_project(db, { ...team, user_id: team.ada.user_id });

    expect(chat.session_id).toBe(old_chat.session_id);
    expect(chat.project_id).toBe(room?.project_id);
    expect(await opens(team.ada.user_id, chat.session_id)).toBe(200);
    expect(await opens(team.ben.user_id, chat.session_id)).toBe(404);
  });

  it('puts the run chat in no room outside team mode, as before', async () => {
    const team = await owner_and_two_members();
    vi.stubEnv('COWORKER_AUTH_MODE', '');

    const chat = await run_chat_of(team, team.ada.user_id);

    expect(chat.project_id).toBeNull();
  });
});
