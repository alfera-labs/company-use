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
import { visible_to_reader } from '@coworker/core/db/queries/session_visibility';
import { create_session } from '@coworker/core/db/queries/sessions';
import { find_team_room_of_maker } from '@coworker/core/db/queries/team_room_of_maker';
import { sessions } from '@coworker/core/db/schema';
import { open_scheduled_task_chat } from '@runtime-platform/events/scheduled_task_chat';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

use_a_fresh_team_install();

type Team = Awaited<ReturnType<typeof owner_and_two_members>>;

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

const chat_list_schema = z.array(z.object({ session_id: z.string() }));

async function chat_ids_listed_for(user_id: string): Promise<string[]> {
  const listed = await call('GET', '/v1/sessions', as_person(user_id));
  expect(listed.status).toBe(200);
  return chat_list_schema.parse(listed.data).map((chat) => chat.session_id);
}

const opens = async (user_id: string, session_id: string) =>
  (await call('GET', `/v1/sessions/${session_id}`, as_person(user_id))).status;

const reads_messages = async (user_id: string, session_id: string) =>
  (await call('GET', `/v1/sessions/${session_id}/messages`, as_person(user_id))).status;

async function key_of(team: Team, person: { user_id: string }) {
  const { api_key } = await create_api_key(db, {
    workspace_id: team.workspace_id,
    key_name: 'A key',
    scopes: ['sessions.read', 'sessions.write'],
    key_audience: 'internal',
    environment_label: 'live',
    actor_id: person.user_id,
  });
  return api_key;
}

async function expect_only_its_person_reaches(
  team: Team,
  person: { user_id: string },
  session_id: string,
) {
  const others = [team.owner, team.ada, team.ben].filter(
    (other) => other.user_id !== person.user_id,
  );
  expect(await chat_ids_listed_for(person.user_id)).toContain(session_id);
  expect(await opens(person.user_id, session_id)).toBe(200);
  for (const other of others) {
    expect(await chat_ids_listed_for(other.user_id)).not.toContain(session_id);
    expect(await opens(other.user_id, session_id)).toBe(404);
    expect(await reads_messages(other.user_id, session_id)).toBe(404);
  }
}

describe('whose chats a person reaches in team mode', () => {
  it('keeps a chat started through an API key to the person who made the key, the owner included', async () => {
    const team = await owner_and_two_members();
    const of_owner = await create_api_session(
      db,
      { api_key: await key_of(team, team.owner), initial_events: [], metadata: {} },
      undefined,
    );
    const of_ada = await create_api_session(
      db,
      { api_key: await key_of(team, team.ada), initial_events: [], metadata: {} },
      undefined,
    );

    await expect_only_its_person_reaches(team, team.owner, of_owner.session_id);
    await expect_only_its_person_reaches(team, team.ada, of_ada.session_id);
  });

  it('keeps the chat of a scheduled task to the person who made the task', async () => {
    const team = await owner_and_two_members();
    const chat = await open_scheduled_task_chat(
      db,
      {
        ...team,
        trigger_id: 'trg_owner',
        trigger_name: 'Owner report',
        created_by: team.owner.user_id,
      },
      {},
    );

    await expect_only_its_person_reaches(team, team.owner, chat.session_id);
  });

  it('moves a task chat that was in no room to the room of its maker when the task runs again', async () => {
    const team = await owner_and_two_members();
    const old_chat = await create_session(db, {
      workspace_id: team.workspace_id,
      agent_id: team.agent_id,
      source_type: 'trigger',
      session_source: 'trigger',
      external_thread_key: 'trigger:trg_old',
      actor_id: 'system:trigger',
    });
    expect(await chat_ids_listed_for(team.ada.user_id)).not.toContain(old_chat.session_id);
    expect(await opens(team.ben.user_id, old_chat.session_id)).toBe(404);

    const chat = await open_scheduled_task_chat(
      db,
      { ...team, trigger_id: 'trg_old', trigger_name: 'Old report', created_by: team.ada.user_id },
      {},
    );
    const room = await find_personal_project(db, { ...team, user_id: team.ada.user_id });

    expect(chat.session_id).toBe(old_chat.session_id);
    expect(chat.project_id).toBe(room?.project_id);
    await expect_only_its_person_reaches(team, team.ada, chat.session_id);
  });

  it('shows a chat in no room only to the person who started it', async () => {
    const team = await owner_and_two_members();
    const chat = await create_session(db, {
      workspace_id: team.workspace_id,
      agent_id: team.agent_id,
      actor_id: team.owner.user_id,
    });

    await expect_only_its_person_reaches(team, team.owner, chat.session_id);
  });

  it('leaves a chat in no room open to every member outside team mode, as before', async () => {
    const team = await owner_and_two_members();
    const chat = await create_session(db, {
      workspace_id: team.workspace_id,
      agent_id: team.agent_id,
      actor_id: team.owner.user_id,
    });
    vi.stubEnv('COWORKER_AUTH_MODE', '');

    const seen_by_ada = await db
      .select({ session_id: sessions.session_id })
      .from(sessions)
      .where(
        and(
          eq(sessions.session_id, chat.session_id),
          visible_to_reader(team.workspace_id, team.ada.user_id),
        ),
      );
    const room = await find_team_room_of_maker(db, { ...team, maker_id: team.owner.user_id });

    expect(seen_by_ada).toHaveLength(1);
    expect(room).toEqual({});
  });
});
