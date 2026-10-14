import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { add_resource_grant } from '@coworker/core/db/queries/resource_grant_entries';
import {
  confirm_source_actor_member_link,
  request_source_actor_member_link,
  upsert_source_actor,
} from '@coworker/core/db/queries/source_actors';
import {
  projects,
  run_messages,
  session_tree_entries,
  sessions,
  users,
  workspace_members,
} from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import {
  list_sessions_tool,
  read_session_messages_tool,
  search_session_messages_tool,
} from '@runtime-platform/tools/definitions/sessions';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

async function workspace() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return { db, ...bootstrap };
}

async function insert_user(db: Database, email: string) {
  const [row] = await db
    .insert(users)
    .values({
      email,
      first_name: 'Test',
      user_status: 'active',
      created_by: 'system',
      last_updated_by: 'system',
    })
    .returning({ user_id: users.user_id });
  if (!row) throw new Error('user_insert_failed');
  return row.user_id;
}

async function insert_session(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    created_by: string;
    session_source?: string;
    project_id?: string;
    source_metadata?: Record<string, unknown>;
  },
) {
  const session_id = create_id(id_prefixes.session);
  await db.insert(sessions).values({
    session_id,
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
    project_id: input.project_id ?? null,
    session_source: input.session_source ?? 'slack',
    source_metadata: input.source_metadata ?? {},
    created_by: input.created_by,
    last_updated_by: input.created_by,
  });
  return session_id;
}

async function add_member(db: Database, workspace_id: string, user_id: string) {
  await db.insert(workspace_members).values({
    workspace_member_id: create_id(id_prefixes.workspace_member),
    workspace_id,
    user_id,
    member_role: 'member',
    created_by: 'system',
    last_updated_by: 'system',
  });
}

async function personal_project_id(db: Database, user_id: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.personal_for_user_id, user_id),
  });
  if (!project) throw new Error('personal_project_missing');
  return project.project_id;
}

async function insert_message(
  db: Database,
  input: { workspace_id: string; session_id: string; content_text: string },
) {
  await db.insert(run_messages).values({
    run_message_id: create_id(id_prefixes.run_message),
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: create_id(id_prefixes.run),
    message_role: 'user',
    message_content: {},
    content_text: input.content_text,
    message_sequence: 1,
    run_message_sequence: 1,
    created_by: 'system',
    last_updated_by: 'system',
  });
}

async function listed_session_ids(ctx: RuntimeToolExecutionContext) {
  const listed = await list_sessions_tool.execute({ limit: 50 }, ctx);
  if (!listed.success) throw new Error('list_sessions_failed');
  return (listed.data as { sessions: { session_id: string }[] }).sessions.map(
    (row) => row.session_id,
  );
}

function context(
  db: Database,
  workspace_id: string,
  agent_id: string,
  actor_id: string,
): RuntimeToolExecutionContext {
  return {
    db,
    workspace_id,
    session_id: 'sess_ctx',
    run_id: 'run_ctx',
    agent_id,
    actor_id,
  };
}

describe('session history is closed to its own participants', () => {
  it('refuses an outsider on list_sessions and read_session_messages', async () => {
    const ws = await workspace();
    const creator_id = await insert_user(ws.db, 'creator@example.com');
    const outsider_id = await insert_user(ws.db, 'outsider@example.com');
    const dm_session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: creator_id,
      source_metadata: { slack: { team_id: 'T1', channel_id: 'D1', channel_type: 'im' } },
    });

    const list_as_outsider = await list_sessions_tool.execute(
      { limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, outsider_id),
    );
    expect(list_as_outsider.success && list_as_outsider.data).toMatchObject({ count: 0 });

    const read_as_outsider = await read_session_messages_tool.execute(
      { session_id: dm_session_id, limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, outsider_id),
    );
    expect(read_as_outsider.success).toBe(false);
  });

  it('allows the creator to list and read their own session', async () => {
    const ws = await workspace();
    const creator_id = await insert_user(ws.db, 'creator2@example.com');
    const dm_session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: creator_id,
      source_metadata: { slack: { team_id: 'T1', channel_id: 'D2', channel_type: 'im' } },
    });

    const list_as_creator = await list_sessions_tool.execute(
      { limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, creator_id),
    );
    expect(list_as_creator.success && list_as_creator.data).toMatchObject({ count: 1 });

    const read_as_creator = await read_session_messages_tool.execute(
      { session_id: dm_session_id, limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, creator_id),
    );
    expect(read_as_creator.success).toBe(true);
  });

  it('allows a message author who is not the creator', async () => {
    const ws = await workspace();
    const creator_id = await insert_user(ws.db, 'creator3@example.com');
    const author_id = await insert_user(ws.db, 'author3@example.com');
    const session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: creator_id,
      source_metadata: { slack: { team_id: 'T1', channel_id: 'D3', channel_type: 'im' } },
    });
    await ws.db.insert(session_tree_entries).values({
      session_tree_entry_id: create_id(id_prefixes.session_tree_entry),
      workspace_id: ws.workspace_id,
      session_id,
      entry_type: 'message',
      entry_sequence: 1,
      entry_data: {},
      actor_id: author_id,
      created_by: author_id,
      last_updated_by: author_id,
    });

    const read_as_author = await read_session_messages_tool.execute(
      { session_id, limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, author_id),
    );
    expect(read_as_author.success).toBe(true);
  });

  it('lets a Slack channel member see the channel session but never a DM session', async () => {
    const ws = await workspace();
    const creator_id = await insert_user(ws.db, 'creator4@example.com');
    const channel_member_id = await insert_user(ws.db, 'member4@example.com');
    const channel_session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: creator_id,
      source_metadata: { slack: { team_id: 'T1', channel_id: 'C4', channel_type: 'channel' } },
    });
    const dm_session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: creator_id,
      source_metadata: { slack: { team_id: 'T1', channel_id: 'D4', channel_type: 'im' } },
    });
    const source_actor = await upsert_source_actor(ws.db, {
      workspace_id: ws.workspace_id,
      provider: 'slack',
      external_id: 'U_MEMBER4',
      actor_id: creator_id,
    });
    await request_source_actor_member_link(ws.db, {
      workspace_id: ws.workspace_id,
      source_actor_id: source_actor.source_actor_id,
      candidate_user_id: channel_member_id,
      actor_id: creator_id,
    });
    await confirm_source_actor_member_link(ws.db, {
      workspace_id: ws.workspace_id,
      source_actor_id: source_actor.source_actor_id,
      actor_id: creator_id,
    });
    await add_resource_grant(ws.db, {
      workspace_id: ws.workspace_id,
      resource_type: 'memory_scope',
      resource_id: 'group:slack:T1:C4',
      grantee_type: 'source_actor',
      grantee_id: source_actor.source_actor_id,
      grant_level: 'use',
      actor_id: creator_id,
    });

    const read_channel_as_member = await read_session_messages_tool.execute(
      { session_id: channel_session_id, limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, channel_member_id),
    );
    expect(read_channel_as_member.success).toBe(true);

    const read_dm_as_member = await read_session_messages_tool.execute(
      { session_id: dm_session_id, limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, channel_member_id),
    );
    expect(read_dm_as_member.success).toBe(false);
  });

  it('refuses an outsider on search_session_messages', async () => {
    const ws = await workspace();
    const creator_id = await insert_user(ws.db, 'creator5@example.com');
    const outsider_id = await insert_user(ws.db, 'outsider5@example.com');
    const session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: creator_id,
      source_metadata: { slack: { team_id: 'T1', channel_id: 'D5', channel_type: 'im' } },
    });
    await ws.db.insert(run_messages).values({
      run_message_id: create_id(id_prefixes.run_message),
      workspace_id: ws.workspace_id,
      session_id,
      run_id: create_id(id_prefixes.run),
      message_role: 'user',
      message_content: {},
      content_text: 'the secret password is unicorn',
      message_sequence: 1,
      run_message_sequence: 1,
      created_by: creator_id,
      last_updated_by: creator_id,
    });

    const search_as_outsider = await search_session_messages_tool.execute(
      { query: 'unicorn', limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, outsider_id),
    );
    expect(search_as_outsider.success && search_as_outsider.data).toMatchObject({ count: 0 });

    const search_as_creator = await search_session_messages_tool.execute(
      { query: 'unicorn', limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, creator_id),
    );
    expect(search_as_creator.success && search_as_creator.data).toMatchObject({ count: 1 });
  });
});

describe('sessions no person started, with no project, stay workspace sessions', () => {
  async function automation_and_email_sessions(
    db: Database,
    workspace_id: string,
    agent_id: string,
  ) {
    const trigger_session_id = await insert_session(db, {
      workspace_id,
      agent_id,
      created_by: 'system:trigger',
      session_source: 'trigger',
    });
    const email_session_id = await insert_session(db, {
      workspace_id,
      agent_id,
      created_by: 'system:email',
      session_source: 'email',
    });
    await insert_message(db, {
      workspace_id,
      session_id: trigger_session_id,
      content_text: 'zq-test morning digest sent',
    });
    await insert_message(db, {
      workspace_id,
      session_id: email_session_id,
      content_text: 'zq-test invoice reply drafted',
    });
    return { trigger_session_id, email_session_id };
  }

  it('lets the only member list, read and search her automation and email sessions', async () => {
    const ws = await workspace();
    const { trigger_session_id, email_session_id } = await automation_and_email_sessions(
      ws.db,
      ws.workspace_id,
      ws.agent_id,
    );
    const as_member = context(ws.db, ws.workspace_id, ws.agent_id, ws.user_id);

    expect(await listed_session_ids(as_member)).toEqual(
      expect.arrayContaining([trigger_session_id, email_session_id]),
    );
    const read = await read_session_messages_tool.execute(
      { session_id: email_session_id, limit: 10 },
      as_member,
    );
    expect(read.success).toBe(true);
    const search = await search_session_messages_tool.execute(
      { query: 'zq-test', limit: 10 },
      as_member,
    );
    expect(search.success && search.data).toMatchObject({ count: 2 });
  });

  it('lets an automation run read an email session', async () => {
    const ws = await workspace();
    const { email_session_id } = await automation_and_email_sessions(
      ws.db,
      ws.workspace_id,
      ws.agent_id,
    );

    const read = await read_session_messages_tool.execute(
      { session_id: email_session_id, limit: 10 },
      context(ws.db, ws.workspace_id, ws.agent_id, 'system:trigger'),
    );
    expect(read.success).toBe(true);
  });

  it('shares them with every member but keeps DMs, private chats and personal projects private', async () => {
    const ws = await workspace();
    const teammate_id = await insert_user(ws.db, 'zq-test-teammate@example.com');
    await add_member(ws.db, ws.workspace_id, teammate_id);
    const { trigger_session_id, email_session_id } = await automation_and_email_sessions(
      ws.db,
      ws.workspace_id,
      ws.agent_id,
    );
    const dm_session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: ws.user_id,
      source_metadata: { slack: { team_id: 'T1', channel_id: 'D9', channel_type: 'im' } },
    });
    const private_chat_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: ws.user_id,
      session_source: 'dashboard',
    });
    const personal_project_session_id = await insert_session(ws.db, {
      workspace_id: ws.workspace_id,
      agent_id: ws.agent_id,
      created_by: 'system:trigger',
      session_source: 'trigger',
      project_id: await personal_project_id(ws.db, ws.user_id),
    });
    await insert_message(ws.db, {
      workspace_id: ws.workspace_id,
      session_id: dm_session_id,
      content_text: 'zq-test private dm note',
    });

    const as_teammate = context(ws.db, ws.workspace_id, ws.agent_id, teammate_id);
    const listed = await listed_session_ids(as_teammate);
    expect(listed).toEqual(expect.arrayContaining([trigger_session_id, email_session_id]));
    expect(listed).not.toContain(dm_session_id);
    expect(listed).not.toContain(private_chat_id);
    expect(listed).not.toContain(personal_project_session_id);

    for (const session_id of [dm_session_id, private_chat_id, personal_project_session_id]) {
      const read = await read_session_messages_tool.execute({ session_id, limit: 10 }, as_teammate);
      expect(read.success).toBe(false);
    }
    const search = await search_session_messages_tool.execute(
      { query: 'zq-test', limit: 10 },
      as_teammate,
    );
    expect(search.success && search.data).toMatchObject({ count: 2 });

    const as_owner = context(ws.db, ws.workspace_id, ws.agent_id, ws.user_id);
    expect(await listed_session_ids(as_owner)).toEqual(
      expect.arrayContaining([
        trigger_session_id,
        email_session_id,
        dm_session_id,
        private_chat_id,
        personal_project_session_id,
      ]),
    );
  });
});
