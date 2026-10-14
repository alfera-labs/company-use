import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import {
  sessions,
  tool_calls,
  users,
  workspace_members,
  workspaces,
} from '@coworker/core/db/schema';
import { send_workspace_email } from '@runtime-platform/channels/email/outbound_email';
import { find_session_by_sent_message_id } from '@runtime-platform/channels/email/sent_messages';
import { read_email_thread_participants } from '@runtime-platform/channels/email/thread_participants';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function seed_workspace(db: Database, options: { with_address?: boolean } = {}) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: 'Acme',
      workspace_slug: 'acme-outbound',
      ...(options.with_address === false ? {} : { inbound_email_username: 'acme' }),
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!workspace) throw new Error('workspace seed failed');

  const [user] = await db
    .insert(users)
    .values({ email: 'owner@acme.com', created_by: 'system:test', last_updated_by: 'system:test' })
    .returning();
  if (!user) throw new Error('user seed failed');
  await db.insert(workspace_members).values({
    workspace_member_id: `wsm_${workspace.workspace_id}`,
    workspace_id: workspace.workspace_id,
    user_id: user.user_id,
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });

  const [session] = await db
    .insert(sessions)
    .values({
      session_id: 'ses_outbound_1',
      workspace_id: workspace.workspace_id,
      agent_id: 'agent_1',
      session_source: 'dashboard',
      source_type: 'dashboard',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!session) throw new Error('session seed failed');
  return { workspace, session };
}

function send_input(
  seeded: Awaited<ReturnType<typeof seed_workspace>>,
  overrides: Partial<Parameters<typeof send_workspace_email>[1]> = {},
) {
  return {
    workspace_id: seeded.workspace.workspace_id,
    session_id: seeded.session.session_id,
    to: ['vendor@example.com'],
    subject: 'Quick question',
    text: 'Which plan should we pick?',
    actor_id: 'user_1',
    source_context: { source_type: 'dashboard' as const },
    ...overrides,
  };
}

function stub_resend_ok(message_id: string | null = '<sent-1@inbox.test.alfera.ai>') {
  const fetch_mock = vi.fn(async (_url: string, init?: { method?: string }) =>
    init?.method === 'POST'
      ? new Response(JSON.stringify({ id: 'sent_1' }), { status: 200 })
      : new Response(JSON.stringify({ id: 'sent_1', message_id }), { status: 200 }),
  );
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubGlobal('fetch', fetch_mock);
  return fetch_mock;
}

const original_daily_send_limit = env.EMAIL_DAILY_SEND_LIMIT;

describe('send_workspace_email', () => {
  afterEach(() => {
    Object.assign(env, { EMAIL_DAILY_SEND_LIMIT: original_daily_send_limit });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends from the plain workspace address, with nothing encoded in it', async () => {
    const fetch_mock = stub_resend_ok();
    const db = await create_test_database();
    const seeded = await seed_workspace(db);

    const sent = await send_workspace_email(db, send_input(seeded));

    expect(sent).toMatchObject({ from: 'acme@inbox.test.alfera.ai', email_id: 'sent_1' });
    const [, init] = fetch_mock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      from: 'acme@inbox.test.alfera.ai',
      to: ['vendor@example.com'],
      subject: 'Quick question',
    });
    expect(body.reply_to).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('+');
  });

  it('records the sent Message-ID so the reply resolves to this conversation', async () => {
    stub_resend_ok();
    const db = await create_test_database();
    const seeded = await seed_workspace(db);

    const sent = await send_workspace_email(db, send_input(seeded));

    expect(sent.message_id).toBe('<sent-1@inbox.test.alfera.ai>');
    const routed = await find_session_by_sent_message_id(db, {
      workspace_id: seeded.workspace.workspace_id,
      message_ids: ['<sent-1@inbox.test.alfera.ai>'],
    });
    expect(routed?.session_id).toBe('ses_outbound_1');
  });

  it('still sends when the provider has not stamped a Message-ID yet', async () => {
    stub_resend_ok(null);
    const db = await create_test_database();
    const seeded = await seed_workspace(db);

    const sent = await send_workspace_email(db, send_input(seeded));

    expect(sent.email_id).toBe('sent_1');
    expect(sent.message_id).toBeUndefined();
  });

  it('makes recipients participants, so their reply is a legitimate continuation', async () => {
    stub_resend_ok();
    const db = await create_test_database();
    const seeded = await seed_workspace(db);

    await send_workspace_email(
      db,
      send_input(seeded, { to: ['vendor@example.com'], cc: ['assistant@example.com'] }),
    );

    const participants = await read_email_thread_participants(db, {
      workspace_id: seeded.workspace.workspace_id,
      session_id: seeded.session.session_id,
    });
    expect(participants.sort()).toEqual(['assistant@example.com', 'vendor@example.com']);
  });

  it('refuses a new outside recipient on an autonomous run', async () => {
    stub_resend_ok();
    const db = await create_test_database();
    const seeded = await seed_workspace(db);

    await expect(
      send_workspace_email(db, send_input(seeded, { source_context: { source_type: 'runtime' } })),
    ).rejects.toMatchObject({ code: 'recipient_not_authorized' });
  });

  it('always allows workspace members, even on an autonomous run', async () => {
    stub_resend_ok();
    const db = await create_test_database();
    const seeded = await seed_workspace(db);

    const sent = await send_workspace_email(
      db,
      send_input(seeded, { to: ['owner@acme.com'], source_context: { source_type: 'runtime' } }),
    );

    expect(sent.to).toEqual(['owner@acme.com']);
  });

  it('allows an autonomous run to keep writing to someone already on the thread', async () => {
    stub_resend_ok();
    const db = await create_test_database();
    const seeded = await seed_workspace(db);

    await send_workspace_email(db, send_input(seeded));
    const follow_up = await send_workspace_email(
      db,
      send_input(seeded, { source_context: { source_type: 'runtime' } }),
    );

    expect(follow_up.to).toEqual(['vendor@example.com']);
  });

  it('refuses to send once the workspace hits its daily cap', async () => {
    stub_resend_ok();
    Object.assign(env, { EMAIL_DAILY_SEND_LIMIT: 1 });
    const db = await create_test_database();
    const seeded = await seed_workspace(db);
    await db.insert(tool_calls).values({
      tool_call_id: 'tc_cap_1',
      workspace_id: seeded.workspace.workspace_id,
      session_id: seeded.session.session_id,
      run_id: 'run_1',
      tool_name: 'email-send-1',
      tool_status: 'completed',
      created_by: 'system:test',
      last_updated_by: 'system:test',
    });

    await expect(send_workspace_email(db, send_input(seeded))).rejects.toMatchObject({
      code: 'email_daily_limit_reached',
    });
  });

  it('tells the agent to create an address first when the workspace has none', async () => {
    stub_resend_ok();
    const db = await create_test_database();
    const seeded = await seed_workspace(db, { with_address: false });

    await expect(send_workspace_email(db, send_input(seeded))).rejects.toMatchObject({
      code: 'workspace_email_address_missing',
    });
  });
});
