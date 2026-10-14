import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  count_unread_messages,
  list_session_newest_sequences,
  session_is_unread,
  session_read_marker,
  set_session_read_marker,
} from '@coworker/core/db/queries/session_read_markers';
import {
  create_run,
  create_run_messages,
  create_session,
  get_session,
} from '@coworker/core/db/queries/sessions';
import { sessions } from '@coworker/core/db/schema/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

async function workspace_with_chat() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  return { db, bootstrap, session, run };
}

async function stored_metadata(db: Database, input: { workspace_id: string; session_id: string }) {
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) throw new Error(`No session ${input.session_id}`);
  return session.session_metadata;
}

async function add_messages(
  db: Awaited<ReturnType<typeof create_test_database>>,
  context: { workspace_id: string; session_id: string; run_id: string; actor_id: string },
  count: number,
) {
  return create_run_messages(
    db,
    Array.from({ length: count }, (_, index) => ({
      workspace_id: context.workspace_id,
      session_id: context.session_id,
      run_id: context.run_id,
      message_role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      message_content: { type: 'text' as const, text: `message ${index}` },
      source_type: 'dashboard' as const,
      actor_id: context.actor_id,
    })),
  );
}

describe('session read markers', () => {
  it('reads back the newest position of each chat, which is what unread compares against', async () => {
    const { db, bootstrap, session, run } = await workspace_with_chat();
    await add_messages(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        actor_id: bootstrap.user_id,
      },
      3,
    );

    const newest = await list_session_newest_sequences(db, bootstrap.workspace_id);

    const chat = newest.find((row) => row.session_id === session.session_id);
    expect(chat?.newest_sequence).toBe(3);
  });

  it('writes the marker into the chat metadata under the reader own id', async () => {
    const { db, bootstrap, session } = await workspace_with_chat();

    await set_session_read_marker(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      reader_id: bootstrap.user_id,
      last_read_sequence: 7,
    });

    const metadata = await stored_metadata(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
    });
    expect(metadata.read_markers).toEqual({ [bootstrap.user_id]: 7 });
  });

  it('never moves a marker backwards when a slower tab reports last', async () => {
    const { db, bootstrap, session } = await workspace_with_chat();
    const marker = {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      reader_id: bootstrap.user_id,
    };

    await set_session_read_marker(db, { ...marker, last_read_sequence: 9 });
    const stale_write = await set_session_read_marker(db, { ...marker, last_read_sequence: 4 });

    expect(stale_write).toBeUndefined();
    const metadata = await stored_metadata(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
    });
    expect(session_read_marker(metadata, bootstrap.user_id)).toBe(9);
  });

  it('gives two readers of the same chat their own answer', async () => {
    const { db, bootstrap, session } = await workspace_with_chat();
    const teammate = 'user_teammate';

    await set_session_read_marker(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      reader_id: bootstrap.user_id,
      last_read_sequence: 9,
    });
    await set_session_read_marker(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      reader_id: teammate,
      last_read_sequence: 3,
    });

    const metadata = await stored_metadata(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
    });

    expect(session_read_marker(metadata, bootstrap.user_id)).toBe(9);
    expect(session_read_marker(metadata, teammate)).toBe(3);
    expect(session_is_unread(metadata, { reader_id: bootstrap.user_id, newest_sequence: 9 })).toBe(
      false,
    );
    expect(session_is_unread(metadata, { reader_id: teammate, newest_sequence: 9 })).toBe(true);
  });

  it('leaves a reader who never opened the chat with everything unread', async () => {
    const { db, bootstrap, session } = await workspace_with_chat();

    const metadata = await stored_metadata(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
    });

    expect(session_read_marker(metadata, bootstrap.user_id)).toBe(0);
    expect(session_is_unread(metadata, { reader_id: bootstrap.user_id, newest_sequence: 1 })).toBe(
      true,
    );
  });

  it('keeps the rest of the chat metadata when a marker is written', async () => {
    const { db, bootstrap, session } = await workspace_with_chat();
    await db
      .update(sessions)
      .set({ session_metadata: { slack_thread_ts: '1720000000.000100' } })
      .where(eq(sessions.session_id, session.session_id));

    await set_session_read_marker(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      reader_id: bootstrap.user_id,
      last_read_sequence: 2,
    });

    const metadata = await stored_metadata(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
    });
    expect(metadata.slack_thread_ts).toBe('1720000000.000100');
    expect(metadata.read_markers).toEqual({ [bootstrap.user_id]: 2 });
  });

  it('counts exactly the messages sitting past the marker', async () => {
    const { db, bootstrap, session, run } = await workspace_with_chat();
    await add_messages(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        session_id: session.session_id,
        run_id: run.run_id,
        actor_id: bootstrap.user_id,
      },
      5,
    );

    const unread_from_start = await count_unread_messages(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      last_read_sequence: 0,
    });
    const unread_from_middle = await count_unread_messages(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      last_read_sequence: 3,
    });
    const unread_when_caught_up = await count_unread_messages(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      last_read_sequence: 5,
    });

    expect(unread_from_start).toBe(5);
    expect(unread_from_middle).toBe(2);
    expect(unread_when_caught_up).toBe(0);
  });
});
