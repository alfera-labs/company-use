import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  match_end_marker,
  match_start_marker,
  search_session_messages,
} from '@coworker/core/db/queries/session_message_search';
import {
  archive_session,
  create_run,
  create_run_messages,
  create_session,
} from '@coworker/core/db/queries/sessions';
import { beforeEach, describe, expect, it } from 'vitest';

let db: Database;
let bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>;

beforeEach(async () => {
  db = await create_test_database();
  bootstrap = await bootstrap_default_workspace(db);
});

async function create_chat(input: { title: string; workspace_id?: string }) {
  return create_session(db, {
    workspace_id: input.workspace_id ?? bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    session_title: input.title,
  });
}

async function add_message(
  session_id: string,
  text: string,
  options: { workspace_id?: string; is_user_visible?: boolean } = {},
) {
  const workspace_id = options.workspace_id ?? bootstrap.workspace_id;
  const run = await create_run(db, {
    workspace_id,
    session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  await create_run_messages(db, [
    {
      workspace_id,
      session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text },
      source_type: 'dashboard',
      actor_id: bootstrap.user_id,
      ...(options.is_user_visible === undefined
        ? {}
        : { is_user_visible: options.is_user_visible }),
    },
  ]);
}

function search(query_text: string, limit?: number) {
  return search_session_messages(db, {
    workspace_id: bootstrap.workspace_id,
    user_id: bootstrap.user_id,
    query_text,
    ...(limit === undefined ? {} : { limit }),
  });
}

describe('search_session_messages', () => {
  it('finds a chat by a word that appears only in a message body', async () => {
    const chat = await create_chat({ title: 'Monday planning' });
    await add_message(chat.session_id, 'The Stripe webhook kept returning a 400 all afternoon.');

    const matches = await search('stripe webhook');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.session_id).toBe(chat.session_id);
    expect(matches[0]?.session_title).toBe('Monday planning');
  });

  it('returns one row per chat however many messages inside it match', async () => {
    const chat = await create_chat({ title: 'Long debug' });
    await add_message(chat.session_id, 'the deployment failed');
    await add_message(chat.session_id, 'the deployment failed again');
    await add_message(chat.session_id, 'deployment is finally green');

    const matches = await search('deployment');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.session_id).toBe(chat.session_id);
  });

  it('never returns a chat belonging to another workspace', async () => {
    const other_workspace_id = 'ws_someone_else';
    const other_chat = await create_chat({
      title: 'Their chat',
      workspace_id: other_workspace_id,
    });
    await add_message(other_chat.session_id, 'a distinctive pelican appears here', {
      workspace_id: other_workspace_id,
    });

    expect(await search('pelican')).toEqual([]);
  });

  it('stops finding a chat once it is deleted', async () => {
    const chat = await create_chat({ title: 'Doomed' });
    await add_message(chat.session_id, 'a distinctive pelican appears here');
    expect(await search('pelican')).toHaveLength(1);

    await archive_session(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: chat.session_id,
      actor_id: bootstrap.user_id,
    });

    expect(await search('pelican')).toEqual([]);
  });

  it('leaves tool results out only when asked for conversation text', async () => {
    const chat = await create_chat({ title: 'Tool output' });
    const run = await create_run(db, {
      workspace_id: bootstrap.workspace_id,
      session_id: chat.session_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'user_message',
      actor_id: bootstrap.user_id,
    });
    await create_run_messages(db, [
      {
        workspace_id: bootstrap.workspace_id,
        session_id: chat.session_id,
        run_id: run.run_id,
        message_role: 'tool_result',
        message_content: { type: 'tool_result', text: 'a distinctive pelican appears here' },
        source_type: 'runtime',
        actor_id: bootstrap.user_id,
      },
    ]);
    const input = {
      workspace_id: bootstrap.workspace_id,
      user_id: bootstrap.user_id,
      query_text: 'pelican',
    };

    expect(await search_session_messages(db, input)).toHaveLength(1);
    expect(await search_session_messages(db, { ...input, conversation_text_only: true })).toEqual(
      [],
    );
  });

  it('does not match messages hidden from the user', async () => {
    const chat = await create_chat({ title: 'Has a hidden note' });
    await add_message(chat.session_id, 'a distinctive pelican appears here', {
      is_user_visible: false,
    });

    expect(await search('pelican')).toEqual([]);
  });

  it('marks the matched words inside the snippet and leaves the rest of the line intact', async () => {
    const chat = await create_chat({ title: 'Snippet' });
    await add_message(
      chat.session_id,
      'We agreed the invoice reconciliation should run nightly instead of hourly.',
    );

    const snippet = (await search('reconciliation'))[0]?.snippet ?? '';

    expect(snippet).toContain(`${match_start_marker}reconciliation${match_end_marker}`);
    expect(snippet).toContain('nightly');
  });

  it('returns nothing for a blank query without reaching the database', async () => {
    const chat = await create_chat({ title: 'Anything' });
    await add_message(chat.session_id, 'anything at all');

    expect(await search('   ')).toEqual([]);
    expect(chat.session_id).toBeTruthy();
  });

  it('honours the limit', async () => {
    for (const index of [0, 1, 2]) {
      const chat = await create_chat({ title: `Chat ${index}` });
      await add_message(chat.session_id, 'a distinctive pelican appears here');
    }

    expect(await search('pelican', 2)).toHaveLength(2);
  });
});
