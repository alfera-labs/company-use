import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { open_personal_project } from '@coworker/core/db/queries/personal_projects';
import {
  archive_session,
  create_session,
  find_or_create_session_for_external_thread,
} from '@coworker/core/db/queries/sessions';
import { sessions } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

describe('session for an external thread', () => {
  it('asks for a title only when it creates the session', async () => {
    const fixture = await create_fixture();
    const build_title = vi.fn().mockResolvedValue('#support thread');

    const created = await find_or_create_session_for_external_thread(fixture.db, {
      ...fixture.thread,
      session_title: build_title,
    });
    const found = await find_or_create_session_for_external_thread(fixture.db, {
      ...fixture.thread,
      session_title: build_title,
    });

    expect(created.session_title).toBe('#support thread');
    expect(found.session_id).toBe(created.session_id);
    expect(build_title).toHaveBeenCalledTimes(1);
  });

  // Drives the collision deterministically instead of with Promise.all: the title function runs
  // after this call has read no session and before it inserts, which is exactly where a second
  // turn lands. Racing two real calls would pass on PGlite whether or not the conflict is caught.
  it('returns the winner when another turn creates the conversation first', async () => {
    const fixture = await create_fixture();
    let winner: Awaited<ReturnType<typeof create_session>> | undefined;

    const session = await find_or_create_session_for_external_thread(fixture.db, {
      ...fixture.thread,
      session_title: async () => {
        winner = await create_session(fixture.db, {
          workspace_id: fixture.thread.workspace_id,
          agent_id: fixture.thread.agent_id,
          source_type: fixture.thread.session_source,
          session_source: fixture.thread.session_source,
          external_thread_key: fixture.thread.external_thread_key,
          session_title: 'Opened by the other turn',
          actor_id: fixture.thread.actor_id,
        });
        return '#support thread';
      },
    });

    expect(winner).toBeDefined();
    expect(session.session_id).toBe(winner?.session_id);
    expect(session.session_title).toBe('Opened by the other turn');
  });

  it('marks the label it wrote as replaceable, and a caller-supplied title as not', async () => {
    const fixture = await create_fixture();

    const named = await find_or_create_session_for_external_thread(fixture.db, {
      ...fixture.thread,
      session_title: 'Weekday 8am briefing',
    });
    const unnamed = await find_or_create_session_for_external_thread(fixture.db, {
      ...fixture.thread,
      external_thread_key: 'slack:T123:C999:thread:1700000000.000002',
    });

    expect(named.session_metadata.title_generation?.source).toBeUndefined();
    expect(unnamed.session_metadata.title_generation?.source).toBe('placeholder');
  });
});

describe('the room an external conversation starts in', () => {
  it('starts the session in the given room', async () => {
    const fixture = await create_fixture();
    const room = await open_personal_project(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      user_id: fixture.bootstrap.user_id,
    });

    const created = await find_or_create_session_for_external_thread(fixture.db, {
      ...fixture.thread,
      project_id: room.project_id,
    });

    expect(created.project_id).toBe(room.project_id);
  });

  it('never moves a conversation that already exists', async () => {
    const fixture = await create_fixture();
    const room = await open_personal_project(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      user_id: fixture.bootstrap.user_id,
    });
    const created = await find_or_create_session_for_external_thread(fixture.db, fixture.thread);

    const found = await find_or_create_session_for_external_thread(fixture.db, {
      ...fixture.thread,
      project_id: room.project_id,
    });

    expect(found.session_id).toBe(created.session_id);
    expect(found.project_id).toBeNull();
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);

  return {
    db,
    bootstrap,
    thread: {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      session_source: 'slack' as const,
      external_thread_key: 'slack:T123:C123:thread:1700000000.000001',
      actor_id: bootstrap.user_id,
    },
  };
}

describe('a deleted chat and its thread', () => {
  it('starts a new chat when the next message arrives in the thread of a deleted one', async () => {
    const fixture = await create_fixture();
    const first = await find_or_create_session_for_external_thread(fixture.db, fixture.thread);
    await fixture.db
      .update(sessions)
      .set({ session_status: 'deleted' })
      .where(eq(sessions.session_id, first.session_id));

    const next = await find_or_create_session_for_external_thread(fixture.db, fixture.thread);

    expect(next.session_id).not.toBe(first.session_id);
    expect(next.session_status).not.toBe('deleted');
  });

  it('frees the thread when the chat is deleted', async () => {
    const fixture = await create_fixture();
    const first = await find_or_create_session_for_external_thread(fixture.db, fixture.thread);

    const deleted = await archive_session(fixture.db, {
      workspace_id: fixture.thread.workspace_id,
      session_id: first.session_id,
      actor_id: fixture.thread.actor_id,
    });
    const next = await find_or_create_session_for_external_thread(fixture.db, fixture.thread);

    expect(deleted.external_thread_key).toBeNull();
    expect(next.session_id).not.toBe(first.session_id);
  });
});
