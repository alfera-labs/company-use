import { create_test_database } from '@coworker/core/db/__tests__/test_database';
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
import { events, workspaces } from '@coworker/core/db/schema';
import { answer_approval_from_email } from '@runtime-platform/channels/email/approval_reply';
import type { InboundEmailMessage } from '@runtime-platform/channels/email/message_format';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('answering an approval by email', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('records the approval when the reply is YES, and says so back', async () => {
    const sent = stub_email_provider();
    const fixture = await create_fixture();

    const answered = await answer_approval_from_email(fixture.db, reply(fixture, 'YES'));

    expect(answered).toEqual({ job_id: fixture.wait.job_id, decision: 'approved' });
    expect(await read_decision(fixture)).toMatchObject({
      job_id: fixture.wait.job_id,
      decision: 'approved',
      reason: 'email reply',
    });
    const [receipt] = sent.mock.calls
      .map(([, init]) => init as unknown as { method?: string; body?: string })
      .filter((init) => init?.method === 'POST')
      .map((init) => JSON.parse(String(init.body)) as { to: string[]; text: string });
    expect(receipt?.to).toEqual([fixture.email]);
    expect(receipt?.text).toContain('Approved. Alfera is doing it now.');
  });

  it('records the refusal when the reply is NO, under the quoted conversation', async () => {
    stub_email_provider();
    const fixture = await create_fixture();

    const answered = await answer_approval_from_email(
      fixture.db,
      reply(fixture, 'no.\n\n> On Monday, Alfera wrote:\n> I need your OK to send an email.'),
    );

    expect(answered).toEqual({ job_id: fixture.wait.job_id, decision: 'denied' });
    expect(await read_decision(fixture)).toMatchObject({ decision: 'denied' });
  });

  it('decides nothing when the reply is a sentence rather than the word', async () => {
    stub_email_provider();
    const fixture = await create_fixture();

    const answered = await answer_approval_from_email(
      fixture.db,
      reply(fixture, 'yes but change the date first'),
    );

    expect(answered).toBeNull();
    expect(await read_decision(fixture)).toBeUndefined();
  });

  it('decides nothing when the body is only the quoted conversation', async () => {
    stub_email_provider();
    const fixture = await create_fixture();

    const answered = await answer_approval_from_email(
      fixture.db,
      reply(fixture, '> YES\n> was what I said last time'),
    );

    expect(answered).toBeNull();
    expect(await read_decision(fixture)).toBeUndefined();
  });

  it('ignores a YES from a member this question was not raised for', async () => {
    const sent = stub_email_provider();
    const fixture = await create_fixture({ eligible_user_ids: ['user_somebody_else'] });

    const answered = await answer_approval_from_email(fixture.db, reply(fixture, 'YES'));

    expect(answered).toEqual({ job_id: fixture.wait.job_id, decision: 'not_a_decider' });
    expect(await read_decision(fixture)).toBeUndefined();
    const [receipt] = sent.mock.calls
      .map(([, init]) => init as unknown as { method?: string; body?: string })
      .filter((init) => init?.method === 'POST')
      .map((init) => JSON.parse(String(init.body)) as { text: string });
    expect(receipt?.text).toContain('not able to approve this');
  });

  it('decides nothing when this conversation has no open question', async () => {
    stub_email_provider();
    const fixture = await create_fixture({ with_a_wait: false });

    const answered = await answer_approval_from_email(fixture.db, reply(fixture, 'YES'));

    expect(answered).toBeNull();
  });
});

function reply(fixture: Awaited<ReturnType<typeof create_fixture>>, body_text: string) {
  return {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    decided_by: fixture.bootstrap.user_id,
    message: {
      email_id: 'email_reply_1',
      from: `Owner <${fixture.email}>`,
      from_email: fixture.email,
      to: ['acme-reply@inbox.test.alfera.ai'],
      cc: [],
      subject: 'Re: Approval needed: send an email',
      body_text,
      attachment_names: [],
      sender_authentication: { dmarc: 'pass', spf: 'pass', dkim: 'pass' },
      references: [],
    } satisfies InboundEmailMessage,
  };
}

async function read_decision(fixture: Awaited<ReturnType<typeof create_fixture>>) {
  const [event] = await fixture.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspace_id, fixture.bootstrap.workspace_id),
        eq(events.event_type, policy_decision_event_type),
      ),
    );
  return event?.event_body as { job_id: string; decision: string; reason?: string } | undefined;
}

function stub_email_provider() {
  const fetch_mock = vi.fn(async (_url: string, init?: { method?: string }) =>
    init?.method === 'POST'
      ? new Response(JSON.stringify({ id: 'sent_receipt_1' }), { status: 200 })
      : new Response(JSON.stringify({ id: 'sent_receipt_1', message_id: null }), { status: 200 }),
  );
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubGlobal('fetch', fetch_mock);
  return fetch_mock;
}

async function create_fixture({
  with_a_wait = true,
  eligible_user_ids,
}: {
  with_a_wait?: boolean;
  eligible_user_ids?: string[];
} = {}) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  await db
    .update(workspaces)
    .set({ inbound_email_username: 'acme-reply' })
    .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
  const user = await db.query.users.findFirst({
    where: (table, { eq: is }) => is(table.user_id, bootstrap.user_id),
  });
  if (!user) throw new Error('bootstrap user missing');

  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'schedule',
    actor_id: bootstrap.user_id,
  });
  const tool_call = await create_tool_call_started(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    tool_name: 'email-send-1',
    tool_input: { to: ['couple@example.com'], subject: 'Your date', text: 'It is free.' },
    tool_status: 'awaiting_approval',
    actor_id: bootstrap.user_id,
  });
  const created = with_a_wait
    ? await create_tool_policy_wait(db, {
        workspace_id: bootstrap.workspace_id,
        queue_key: 'wait:tool_policy:email_reply_test',
        wait: {
          version: 2,
          kind: 'tool_policy_approval',
          session_id: session.session_id,
          source_run_id: run.run_id,
          calls: [{ tool_call_id: tool_call.tool_call_id, input_sha256: 'a'.repeat(64) }],
          requested_by: bootstrap.user_id,
          eligible_user_ids: eligible_user_ids ?? [bootstrap.user_id],
        },
        actor_id: bootstrap.user_id,
      })
    : null;

  return {
    db,
    bootstrap,
    session,
    email: user.email,
    wait: created?.event_job ?? { job_id: 'none' },
  };
}
