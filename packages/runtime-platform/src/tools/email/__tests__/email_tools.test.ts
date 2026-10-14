import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { workspaces } from '@coworker/core/db/schema';
import { email_create_address_tool } from '@runtime-platform/tools/email/create_address';
import { email_respond_tool } from '@runtime-platform/tools/email/respond';
import { email_send_tool } from '@runtime-platform/tools/email/send';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function seed_workspace(db: Database, overrides: { inbound_email_username?: string } = {}) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: 'Acme',
      workspace_slug: 'acme-tools',
      ...overrides,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!workspace) throw new Error('workspace seed failed');
  return workspace;
}

function tool_context(db: Database, workspace_id: string): RuntimeToolExecutionContext {
  return {
    db,
    workspace_id,
    session_id: 'sess_1',
    run_id: 'run_1',
    actor_id: 'user_1',
  };
}

const email_turn_metadata = {
  email: {
    email_id: 'em_1',
    workspace_address: 'acme@inbox.test.alfera.ai',
    reply_to_email: 'ada@example.com',
    reply_cc: ['carol@example.com'],
    reply_expected: true,
    subject: 'Weekly update',
    message_id: '<msg-2@example.com>',
    references: ['<msg-1@example.com>', '<msg-2@example.com>'],
  },
};

describe('email_respond_tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends a threaded reply to the turn sender through Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    const fetch_mock = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/emails')
        ? new Response(JSON.stringify({ id: 'sent_1' }), { status: 200 })
        : new Response(JSON.stringify({ id: 'sent_1', message_id: '<stamped@resend>' }), {
            status: 200,
          }),
    );
    vi.stubGlobal('fetch', fetch_mock);
    const db = await create_test_database();
    const workspace = await seed_workspace(db);

    const result = await email_respond_tool.execute(
      { resolution_type: 'reply', message: 'Here is your answer.' },
      {
        ...tool_context(db, workspace.workspace_id),
        source_context: { source_type: 'email', source_metadata: email_turn_metadata },
      },
    );

    expect(result.success).toBe(true);
    expect(fetch_mock).toHaveBeenCalledTimes(2);
    const [url, init] = fetch_mock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://api.resend.com/emails');
    expect(fetch_mock.mock.calls[1]?.[0]).toBe('https://api.resend.com/emails/sent_1');
    expect(JSON.parse(init.body)).toMatchObject({
      from: 'acme@inbox.test.alfera.ai',
      to: ['ada@example.com'],
      cc: ['carol@example.com'],
      subject: 'Re: Weekly update',
      text: "Here is your answer.\n\n— Sent by Acme's AI agent on Alfera.",
      headers: {
        'In-Reply-To': '<msg-2@example.com>',
        References: '<msg-1@example.com> <msg-2@example.com>',
      },
    });
  });

  it('reports a provider failure as email_send_failed instead of throwing', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 500 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = await create_test_database();
    const workspace = await seed_workspace(db);

    const result = await email_respond_tool.execute(
      { resolution_type: 'reply', message: 'Hello' },
      {
        ...tool_context(db, workspace.workspace_id),
        source_context: { source_type: 'email', source_metadata: email_turn_metadata },
      },
    );

    expect(result).toMatchObject({ success: false, error: { code: 'email_send_failed' } });
    vi.restoreAllMocks();
  });

  it('refuses to run outside a trusted email turn', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db);

    const result = await email_respond_tool.execute(
      { resolution_type: 'reply', message: 'Hello' },
      {
        ...tool_context(db, workspace.workspace_id),
        source_context: { source_type: 'dashboard' },
      },
    );

    expect(result).toMatchObject({ success: false, error: { code: 'email_turn_required' } });
  });
});

describe('email_send_tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('starts an email conversation from a dashboard turn', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    const fetch_mock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'sent_9' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch_mock);
    const db = await create_test_database();
    const workspace = await seed_workspace(db, { inbound_email_username: 'acme' });

    const result = await email_send_tool.execute(
      { to: ['vendor@example.com'], subject: 'Quick question', message: 'Which plan?' },
      {
        ...tool_context(db, workspace.workspace_id),
        source_context: { source_type: 'dashboard' },
      },
    );

    expect(result).toMatchObject({
      success: true,
      data: { sent: true, from: 'acme@inbox.test.alfera.ai', email_id: 'sent_9' },
    });
  });

  it('reports an unauthorized recipient as a tool error instead of throwing', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'sent_9' }), { status: 200 })),
    );
    const db = await create_test_database();
    const workspace = await seed_workspace(db, { inbound_email_username: 'acme' });

    const result = await email_send_tool.execute(
      { to: ['stranger@example.com'], subject: 'Hi', message: 'Hello' },
      {
        ...tool_context(db, workspace.workspace_id),
        source_context: { source_type: 'runtime' },
      },
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'recipient_not_authorized' },
    });
  });
});

describe('email_create_address_tool', () => {
  it('creates the address from the workspace name and is idempotent', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db);
    const context = tool_context(db, workspace.workspace_id);

    const created = await email_create_address_tool.execute({}, context);
    expect(created).toMatchObject({
      success: true,
      data: { email_address: 'acme@inbox.test.alfera.ai', created: true },
    });

    const repeated = await email_create_address_tool.execute({}, context);
    expect(repeated).toMatchObject({
      success: true,
      data: { email_address: 'acme@inbox.test.alfera.ai', created: false },
    });

    const conflicting = await email_create_address_tool.execute(
      { username: 'different-name' },
      context,
    );
    expect(conflicting).toMatchObject({
      success: false,
      error: { code: 'email_username_already_set' },
    });
  });

  it('refuses reserved role usernames on the shared domain', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db);

    const result = await email_create_address_tool.execute(
      { username: 'support' },
      tool_context(db, workspace.workspace_id),
    );

    expect(result).toMatchObject({ success: false, error: { code: 'email_username_reserved' } });
  });

  it('reports a taken username as a named conflict', async () => {
    const db = await create_test_database();
    await seed_workspace(db, { inbound_email_username: 'taken' });
    const [second] = await db
      .insert(workspaces)
      .values({
        workspace_name: 'Second',
        workspace_slug: 'second-tools',
        created_by: 'system:test',
        last_updated_by: 'system:test',
      })
      .returning();
    if (!second) throw new Error('workspace seed failed');

    const result = await email_create_address_tool.execute(
      { username: 'taken' },
      tool_context(db, second.workspace_id),
    );

    expect(result).toMatchObject({ success: false, error: { code: 'email_username_taken' } });
  });
});
