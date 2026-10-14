import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { workspaces } from '@coworker/core/db/schema';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import { prepare_email_channel_event_jobs } from '@runtime-platform/channels/email/channel_event_queue';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

async function seed_workspace(
  db: Database,
  inbound_email_username: string,
  overrides: { workspace_status?: string } = {},
) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      workspace_name: 'Acme',
      workspace_slug: `acme-${inbound_email_username}`,
      inbound_email_username,
      ...overrides,
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!workspace) throw new Error('workspace seed failed');
  return workspace;
}

function received_event(overrides: Record<string, unknown> = {}): VerifiedChannelEvent {
  return {
    channel_provider_key: 'email',
    provider_event_id: 'em_1',
    received_time: new Date('2026-08-01T00:00:00.000Z'),
    provider_event_type: 'email.received',
    raw_event: {
      type: 'email.received',
      data: {
        email_id: 'em_1',
        from: 'Ada <ada@example.com>',
        to: ['acme@inbox.test.alfera.ai'],
        subject: 'Re: Weekly update',
        message_id: '<abc@example.com>',
        ...overrides,
      },
    },
  };
}

describe('prepare_email_channel_event_jobs', () => {
  it('routes a received email to the workspace owning the recipient address', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db, 'acme');

    const prepared = await prepare_email_channel_event_jobs(db, received_event());

    expect(prepared).toMatchObject({
      workspace_id: workspace.workspace_id,
      source: 'email',
      source_event_id: 'received:em_1',
      event_status: 'routed',
      actor_key: 'email:ada@example.com',
    });
    expect(prepared?.queue_key).toBe(`email:${workspace.workspace_id}:received:em_1`);
    expect(prepared?.event_jobs).toHaveLength(1);
    expect(prepared?.event_jobs?.[0]?.job_handler).toBe('email_agent_message');
  });

  it('routes via cc when the managed address is only copied', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db, 'copyteam');

    const prepared = await prepare_email_channel_event_jobs(
      db,
      received_event({ to: ['someone@example.com'], cc: ['copyteam@inbox.test.alfera.ai'] }),
    );

    expect(prepared?.workspace_id).toBe(workspace.workspace_id);
    expect(prepared?.event_status).toBe('routed');
  });

  it('drops mail whose recipients match no workspace', async () => {
    const db = await create_test_database();
    await seed_workspace(db, 'other');

    const prepared = await prepare_email_channel_event_jobs(
      db,
      received_event({ to: ['nobody@inbox.test.alfera.ai'] }),
    );

    expect(prepared).toBeNull();
  });

  it('still routes mail sent to an address the workspace has retired', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db, 'acme-new');
    await db
      .update(workspaces)
      .set({ workspace_data: { inbound_email: { retired_usernames: ['acme'] } } })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));

    const prepared = await prepare_email_channel_event_jobs(db, received_event());

    expect(prepared?.workspace_id).toBe(workspace.workspace_id);
    expect(prepared?.event_status).toBe('routed');
  });

  it('records mail as ignored when the workspace has disabled its inbox', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db, 'paused');
    await db
      .update(workspaces)
      .set({ workspace_data: { inbound_email: { enabled: false } } })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));

    const prepared = await prepare_email_channel_event_jobs(
      db,
      received_event({ to: ['paused@inbox.test.alfera.ai'] }),
    );

    expect(prepared).toMatchObject({
      workspace_id: workspace.workspace_id,
      event_status: 'ignored',
      metadata: { ignored_reason: 'inbox_disabled' },
    });
    expect(prepared?.event_jobs).toHaveLength(0);
  });

  it('records mail from the managed domain as ignored so agents cannot loop', async () => {
    const db = await create_test_database();
    const workspace = await seed_workspace(db, 'loopy');

    const prepared = await prepare_email_channel_event_jobs(
      db,
      received_event({
        to: ['loopy@inbox.test.alfera.ai'],
        from: 'Other Agent <other@inbox.test.alfera.ai>',
      }),
    );

    expect(prepared).toMatchObject({
      workspace_id: workspace.workspace_id,
      event_status: 'ignored',
      metadata: { ignored_reason: 'managed_domain_sender' },
    });
    expect(prepared?.event_jobs).toHaveLength(0);
  });

  it('records mail from no-reply senders as ignored', async () => {
    const db = await create_test_database();
    await seed_workspace(db, 'quiet');

    const prepared = await prepare_email_channel_event_jobs(
      db,
      received_event({
        to: ['quiet@inbox.test.alfera.ai'],
        from: 'no-reply@newsletter.example.com',
      }),
    );

    expect(prepared?.event_status).toBe('ignored');
    expect(prepared?.metadata).toMatchObject({ ignored_reason: 'auto_generated_sender' });
  });

  it('drops mail whose payload fails the webhook schema or has an unparsable sender', async () => {
    const db = await create_test_database();
    await seed_workspace(db, 'strict');

    expect(
      await prepare_email_channel_event_jobs(db, received_event({ from: 'garbled-no-address' })),
    ).toBeNull();
    const missing_id = received_event();
    (missing_id.raw_event as { data: Record<string, unknown> }).data.email_id = '';
    expect(await prepare_email_channel_event_jobs(db, missing_id)).toBeNull();
  });

  it('does not route mail to a suspended workspace', async () => {
    const db = await create_test_database();
    await seed_workspace(db, 'frozen', { workspace_status: 'suspended' });

    const prepared = await prepare_email_channel_event_jobs(
      db,
      received_event({ to: ['frozen@inbox.test.alfera.ai'] }),
    );

    expect(prepared).toBeNull();
  });

  it('prefers the To recipient over the Cc recipient when both are workspace addresses', async () => {
    const db = await create_test_database();
    const to_workspace = await seed_workspace(db, 'primary');
    await seed_workspace(db, 'copied');

    const prepared = await prepare_email_channel_event_jobs(
      db,
      received_event({
        to: ['primary@inbox.test.alfera.ai'],
        cc: ['copied@inbox.test.alfera.ai'],
      }),
    );

    expect(prepared?.workspace_id).toBe(to_workspace.workspace_id);
  });

  it('drops non-received webhook types', async () => {
    const db = await create_test_database();
    await seed_workspace(db, 'acme2');

    const prepared = await prepare_email_channel_event_jobs(db, {
      ...received_event(),
      provider_event_type: 'email.delivered',
    });

    expect(prepared).toBeNull();
  });
});
