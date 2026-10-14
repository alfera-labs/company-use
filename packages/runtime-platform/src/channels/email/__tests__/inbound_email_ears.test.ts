import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_tool_policy_wait,
  policy_decision_event_type,
} from '@coworker/core/db/queries/event_waits';
import {
  create_run,
  create_session,
  create_tool_call_started,
} from '@coworker/core/db/queries/sessions';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events, workspaces } from '@coworker/core/db/schema';
import type { TriggerRule } from '@coworker/core/db/schema/json_column_types';
import { start_email_channel_turn } from '@runtime-platform/channels/email/channel_turn';
import { fire_inbound_email_ears } from '@runtime-platform/channels/email/inbound_email_ears';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_trigger_node_keys,
  seed_native_trigger_catalog,
} from '@runtime-platform/tools/native_trigger_seed';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspace_username = 'ears';
const thread_root = '<thread-root-1@example.com>';

describe('the inbound address as an automation ear', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('fires the ear on the thread, carrying the mail as data', async () => {
    const fixture = await create_fixture();

    const fired = await fire_inbound_email_ears(fixture.db, {
      workspace_id: fixture.workspace_id,
      message: reply_on_the_thread('Can you re-send the invoice?'),
    });

    expect(fired.fired).toEqual([
      {
        trigger_id: fixture.trigger_id,
        automation_id: fixture.automation_id,
        event_id: expect.any(String),
      },
    ]);
    const [fire] = await read_trigger_fires(fixture.db, fixture.workspace_id);
    expect(fire?.queue_key).toBe(`automation:${fixture.automation_id}:subject:${thread_root}`);
    expect(
      (fire?.event_body as { delivery: { data: Record<string, unknown> } }).delivery.data,
    ).toMatchObject({
      thread_id: thread_root,
      sender: 'customer@example.com',
      subject: 'Re: the invoice',
      message_text: 'Can you re-send the invoice?',
      sender_is_verified_member: false,
    });
  });

  it('carries the DMARC-checked member verdict, so only a proven member takes a thread over', async () => {
    const fixture = await create_fixture();
    const from_the_member = {
      ...reply_on_the_thread('I have got this one.'),
      from: `Owner <${fixture.member_email}>`,
      from_email: fixture.member_email,
    };

    await fire_inbound_email_ears(fixture.db, {
      workspace_id: fixture.workspace_id,
      message: from_the_member,
    });
    await fire_inbound_email_ears(fixture.db, {
      workspace_id: fixture.workspace_id,
      message: {
        ...from_the_member,
        email_id: 'em_ear_2',
        message_id: '<reply-3@example.com>',
        sender_authentication: { dmarc: 'fail', spf: 'pass', dkim: 'none' },
      },
    });

    const flags = (await read_trigger_fires(fixture.db, fixture.workspace_id)).map(
      (fire) =>
        (fire.event_body as { delivery: { data: { sender_is_verified_member: boolean } } }).delivery
          .data.sender_is_verified_member,
    );
    expect(flags).toEqual([true, false]);
  });

  it('says nothing to an ear whose conditions does not match', async () => {
    const fixture = await create_fixture({
      conditions: [{ field: 'subject', operation: 'contains_any_of', values: ['refund'] }],
    });

    const fired = await fire_inbound_email_ears(fixture.db, {
      workspace_id: fixture.workspace_id,
      message: reply_on_the_thread('Can you re-send the invoice?'),
    });

    expect(fired.fired).toEqual([]);
    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(0);
  });

  it('decides the held approval and starts no automation when a member replies YES', async () => {
    stub_email_provider();
    const fixture = await create_fixture();
    const wait = await hold_a_tool_call(fixture);

    const result = await start_email_channel_turn(fixture.db, {
      workspace_id: fixture.workspace_id,
      workspace_username,
      message: {
        ...reply_on_the_thread('YES'),
        from: `Owner <${fixture.member_email}>`,
        from_email: fixture.member_email,
      },
    });

    expect(result).toMatchObject({ accepted: false, code: 'approval_answered' });
    const [decision] = await fixture.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.workspace_id, fixture.workspace_id),
          eq(events.event_type, policy_decision_event_type),
        ),
      );
    expect(decision?.event_body).toMatchObject({ job_id: wait.job_id, decision: 'approved' });
    expect(await read_trigger_fires(fixture.db, fixture.workspace_id)).toHaveLength(0);
  });
});

function reply_on_the_thread(body_text: string): InboundEmailMessage {
  return {
    email_id: 'em_ear_1',
    from: 'Customer <customer@example.com>',
    from_email: 'customer@example.com',
    to: [`${workspace_username}@inbox.test.alfera.ai`],
    cc: [],
    subject: 'Re: the invoice',
    body_text,
    attachment_names: [],
    sender_authentication: { dmarc: 'pass', spf: 'pass', dkim: 'pass' },
    message_id: '<reply-2@example.com>',
    in_reply_to: thread_root,
    references: [thread_root],
  };
}

async function read_trigger_fires(db: Database, workspace_id: string) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.workspace_id, workspace_id), eq(events.event_type, 'trigger.fired')));
}

async function create_fixture(options: { conditions?: TriggerRule[] } = {}) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await seed_native_trigger_catalog(db);
  await db
    .update(workspaces)
    .set({ inbound_email_username: workspace_username })
    .where(eq(workspaces.workspace_id, bootstrap.workspace_id));

  const automation = await create_automation(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_name: 'Answer the mail',
    instruction: 'Answer anyone who writes in.',
    run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [{ field: 'sender', operation: 'is_absent' }],
    judge: null,
    actor_id: bootstrap.user_id,
  });
  const trigger = await create_trigger(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_id: automation.automation_id,
    trigger_name: 'Someone emails your coworker',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      event_source: { node_key: native_trigger_node_keys.inbound_email },
      ...(options.conditions ? { rules: options.conditions } : {}),
    },
    trigger_status: 'enabled',
    actor_id: bootstrap.user_id,
  });
  const user = await db.query.users.findFirst({
    where: (table, { eq: is }) => is(table.user_id, bootstrap.user_id),
  });
  if (!user?.email) throw new Error('bootstrap user has no email');

  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_source: 'email',
    source_type: 'email',
    external_thread_key: `email:${bootstrap.workspace_id}:${thread_root}`,
    actor_id: bootstrap.user_id,
  });

  return {
    db,
    bootstrap,
    workspace_id: bootstrap.workspace_id,
    automation_id: automation.automation_id,
    trigger_id: trigger.trigger_id,
    session_id: session.session_id,
    member_email: user.email,
  };
}

async function hold_a_tool_call(fixture: Awaited<ReturnType<typeof create_fixture>>) {
  const run = await create_run(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    agent_id: fixture.bootstrap.agent_id,
    trigger_type: 'schedule',
    actor_id: fixture.bootstrap.user_id,
  });
  const tool_call = await create_tool_call_started(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: run.run_id,
    tool_name: 'email-send-1',
    tool_input: { to: ['customer@example.com'], subject: 'Your invoice', text: 'Here it is.' },
    tool_status: 'awaiting_approval',
    actor_id: fixture.bootstrap.user_id,
  });
  const created = await create_tool_policy_wait(fixture.db, {
    workspace_id: fixture.workspace_id,
    queue_key: 'wait:tool_policy:inbound_email_ears_test',
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: fixture.session_id,
      source_run_id: run.run_id,
      calls: [{ tool_call_id: tool_call.tool_call_id, input_sha256: 'b'.repeat(64) }],
      requested_by: fixture.bootstrap.user_id,
      eligible_user_ids: [fixture.bootstrap.user_id],
    },
    actor_id: fixture.bootstrap.user_id,
  });
  return created.event_job;
}

function stub_email_provider() {
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url: string, init?: { method?: string }) =>
        new Response(JSON.stringify({ id: 'sent_receipt_1', message_id: null }), {
          status: init?.method === 'POST' ? 200 : 200,
        }),
    ),
  );
}
