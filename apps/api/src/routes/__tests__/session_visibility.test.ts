import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import { set_project_member } from '@coworker/core/db/queries/project_members';
import { create_project } from '@coworker/core/db/queries/projects';
import { create_session, list_sessions } from '@coworker/core/db/queries/sessions';
import { describe, expect, it } from 'vitest';

async function workspace_with_a_private_room() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const workspace_id = bootstrap.workspace_id;
  const agent_id = bootstrap.agent_id;

  const room = await create_project(db, {
    workspace_id,
    project_name: 'Acme Support',
    actor_id: 'user_alice',
    owner_id: 'user_alice',
  });
  const inside = await create_session(db, {
    workspace_id,
    agent_id,
    session_title: 'Refund question',
    project_id: room.project_id,
    actor_id: 'user_alice',
  });
  const outside = await create_session(db, {
    workspace_id,
    agent_id,
    session_title: 'Q3 planning',
    actor_id: 'user_alice',
  });

  return { db, workspace_id, agent_id, room, inside, outside };
}

function titles(rows: { session_title: string | null }[]) {
  return rows.map((row) => row.session_title).sort();
}

describe('which chats a person may read', () => {
  it('hides a room’s chat from someone outside the room', async () => {
    const { db, workspace_id, inside } = await workspace_with_a_private_room();

    const bob_sees = await list_sessions(db, workspace_id, { visible_to_user_id: 'user_bob' });

    expect(bob_sees.map((row) => row.session_id)).not.toContain(inside.session_id);
  });

  it('shows it to the member who owns the room', async () => {
    const { db, workspace_id, inside } = await workspace_with_a_private_room();

    const alice_sees = await list_sessions(db, workspace_id, { visible_to_user_id: 'user_alice' });

    expect(alice_sees.map((row) => row.session_id)).toContain(inside.session_id);
  });

  it('keeps a chat in no room visible to everyone, exactly as before rooms existed', async () => {
    const { db, workspace_id, outside } = await workspace_with_a_private_room();

    const bob_sees = await list_sessions(db, workspace_id, { visible_to_user_id: 'user_bob' });

    expect(bob_sees.map((row) => row.session_id)).toContain(outside.session_id);
  });

  it('shows the room’s chat the moment the person is added, and not before', async () => {
    const { db, workspace_id, room, inside } = await workspace_with_a_private_room();
    expect(
      (await list_sessions(db, workspace_id, { visible_to_user_id: 'user_bob' })).map(
        (row) => row.session_id,
      ),
    ).not.toContain(inside.session_id);

    await set_project_member(db, {
      workspace_id,
      project_id: room.project_id,
      grantee_type: 'user',
      grantee_id: 'user_bob',
      grant_level: 'use',
      actor_id: 'user_alice',
    });

    expect(
      (await list_sessions(db, workspace_id, { visible_to_user_id: 'user_bob' })).map(
        (row) => row.session_id,
      ),
    ).toContain(inside.session_id);
  });

  it('never leaks one person’s own room to another', async () => {
    const { db, workspace_id, agent_id } = await workspace_with_a_private_room();
    const alices_room = await open_personal_project(db, {
      workspace_id,
      user_id: 'user_alice',
    });
    await create_session(db, {
      workspace_id,
      agent_id,
      session_title: 'Draft to legal',
      project_id: alices_room.project_id,
      actor_id: 'user_alice',
    });

    const bob_sees = await list_sessions(db, workspace_id, { visible_to_user_id: 'user_bob' });

    expect(titles(bob_sees)).not.toContain('Draft to legal');
  });
});

describe('starting a chat without naming a room', () => {
  it('puts it in the caller’s own room', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    const created = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_title: 'Draft to legal' }),
    });
    const body = await created.json();

    expect(created.status).toBe(201);
    expect(body.data.project_id).not.toBeNull();
  });

  it('opens that room once, however many chats are started', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);
    const app = create_app(db);

    const rooms = [];
    for (const title of ['first', 'second', 'third']) {
      const response = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_title: title }),
      });
      rooms.push((await response.json()).data.project_id);
    }

    expect(new Set(rooms).size).toBe(1);
  });
});
