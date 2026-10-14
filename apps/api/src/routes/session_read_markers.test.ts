import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_run,
  create_run_messages,
  create_session,
  get_session,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { beforeEach, describe, expect, it } from 'vitest';

type App = ReturnType<typeof create_app>;

let db: Database;
let app: App;
let bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>;

async function create_chat_with_message(text: string) {
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  await add_message(session.session_id, text);
  return session.session_id;
}

async function add_message(session_id: string, text: string) {
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  await create_run_messages(db, [
    {
      workspace_id: bootstrap.workspace_id,
      session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
    },
  ]);
}

async function list_sessions() {
  const response = await app.request('/v1/sessions');
  return (
    (await response.json()) as {
      data: {
        session_id: string;
        is_unread: boolean;
        newest_sequence: number;
        latest_run: {
          run_id: string;
          run_status: string;
          finished_time: string | null;
          created_time: string;
        } | null;
      }[];
    }
  ).data;
}

async function mark_read(session_id: string, last_read_sequence: number, extra?: object) {
  return app.request(`/v1/sessions/${session_id}/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ last_read_sequence, ...extra }),
  });
}

beforeEach(async () => {
  db = await create_test_database();
  bootstrap = await bootstrap_default_workspace(db);
  app = create_app(db);
});

describe('unread on the sessions list', () => {
  it('includes the latest top-level run summary for the sidebar', async () => {
    const session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const root_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      parent_run_id: root_run.run_id,
      root_run_id: root_run.run_id,
      actor_id: bootstrap.user_id,
    });
    await update_run_status(db, {
      run_id: root_run.run_id,
      run_status: 'completed',
      actor_id: bootstrap.user_id,
    });
    const active_session = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });
    const active_run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: active_session.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });

    const chats = await list_sessions();
    const chat = chats.find((row) => row.session_id === session.session_id);
    const active_chat = chats.find((row) => row.session_id === active_session.session_id);

    expect(chat?.latest_run).toMatchObject({
      run_id: root_run.run_id,
      run_status: 'completed',
    });
    expect(chat?.latest_run?.finished_time).toEqual(expect.any(String));
    expect(active_chat?.latest_run).toMatchObject({
      run_id: active_run.run_id,
      run_status: 'queued',
      finished_time: null,
    });
  });

  it('answers unread on the list itself, so the sidebar needs one request', async () => {
    const session_id = await create_chat_with_message('Reconcile the Stripe payouts.');

    const sessions = await list_sessions();

    const chat = sessions.find((row) => row.session_id === session_id);
    expect(chat?.is_unread).toBe(true);
    expect(chat?.newest_sequence).toBeGreaterThan(0);
  });

  it('goes read once the marker reaches the newest message, and stays read', async () => {
    const session_id = await create_chat_with_message('First question.');
    const before = (await list_sessions()).find((row) => row.session_id === session_id);

    const response = await mark_read(session_id, before?.newest_sequence ?? 0);
    expect(response.status).toBe(200);

    const after = (await list_sessions()).find((row) => row.session_id === session_id);
    expect(after?.is_unread).toBe(false);
  });

  it('stores the marker on the chat it belongs to, keyed by the reader', async () => {
    const session_id = await create_chat_with_message('First question.');
    const before = (await list_sessions()).find((row) => row.session_id === session_id);

    await mark_read(session_id, before?.newest_sequence ?? 0);

    const session = await get_session(db, bootstrap.workspace_id, session_id);
    expect(session?.session_metadata.read_markers).toEqual({
      [bootstrap.user_id]: before?.newest_sequence,
    });
  });

  it('goes unread again when a new message lands, with no write of its own', async () => {
    const session_id = await create_chat_with_message('First question.');
    const first = (await list_sessions()).find((row) => row.session_id === session_id);
    await mark_read(session_id, first?.newest_sequence ?? 0);

    await add_message(session_id, 'Second question.');

    const after = (await list_sessions()).find((row) => row.session_id === session_id);
    expect(after?.is_unread).toBe(true);
  });

  it('does not float a chat up the sidebar for having been read', async () => {
    const session_id = await create_chat_with_message('First question.');
    const before = await get_session(db, bootstrap.workspace_id, session_id);

    await mark_read(session_id, 1);

    const after = await get_session(db, bootstrap.workspace_id, session_id);
    expect(after?.last_updated_time).toEqual(before?.last_updated_time);
  });

  it('refuses a position that is not a whole message number', async () => {
    const session_id = await create_chat_with_message('First question.');

    const response = await mark_read(session_id, -1);

    expect(response.status).toBe(422);
  });

  it('ignores a reader supplied in the body and uses the caller', async () => {
    const session_id = await create_chat_with_message('First question.');
    const before = (await list_sessions()).find((row) => row.session_id === session_id);

    await mark_read(session_id, before?.newest_sequence ?? 0, { reader_id: 'user_someone_else' });

    const after = (await list_sessions()).find((row) => row.session_id === session_id);
    expect(after?.is_unread).toBe(false);

    const session = await get_session(db, bootstrap.workspace_id, session_id);
    expect(Object.keys(session?.session_metadata.read_markers ?? {})).toEqual([bootstrap.user_id]);
  });
});
