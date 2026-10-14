import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  cancel_pending_connection_setup,
  expire_stale_pending_connection_setups,
  pending_connection_setup_expiry_ms,
} from '@coworker/core/db/queries/connection_management';
import { postpone_pending_connection_resume } from '@coworker/core/db/queries/connection_resume_state';
import {
  create_run,
  create_run_message,
  create_session,
  update_run_status,
  upsert_session_source_actor,
} from '@coworker/core/db/queries/sessions';
import { connections, event_jobs, events } from '@coworker/core/db/schema';
import {
  agent_heartbeat_session_kind,
  agent_heartbeat_session_thread_prefix,
  ConflictError,
  create_external_source_actor,
} from '@coworker/shared';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_turn = vi.hoisted(() => ({
  start: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({
    accepted: true,
    session_id: 'ses_slack',
    run_id: 'run_resume',
    external_thread_key: 'slack:T123:C123:thread:1700000000.000001',
    configured_channel_id: null,
  })),
}));

vi.mock('@runtime-platform/channels/slack/channel_turn', () => ({
  start_slack_channel_turn: slack_turn.start,
}));

const orchestrator = vi.hoisted(() => ({
  start_run: vi.fn(
    async (
      _db: unknown,
      _input: Record<string, unknown>,
      options?: {
        on_stream_event?: (event: {
          type: 'run_created';
          run: { run_id: string };
        }) => Promise<void>;
      },
    ) => {
      await options?.on_stream_event?.({
        type: 'run_created',
        run: { run_id: 'run_chat_resume' },
      });
      return { run_id: 'run_chat_resume' };
    },
  ),
}));

vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  start_agent_run: orchestrator.start_run,
}));

const { connection_resume_expiry_ms, enqueue_connection_resume, run_connection_resume_job } =
  await import('@runtime-platform/events/connection_resume_job');
const { start_resumes_for_expired_connection_setups } = await import(
  '@runtime-platform/connections/connection_resume_activation'
);

describe('connection_resume_job', () => {
  beforeEach(() => {
    slack_turn.start.mockClear();
    orchestrator.start_run.mockClear();
  });

  it('recovers a completed chat resume even after the original setup intent expires', async () => {
    const fixture = await create_chat_fixture();
    const event = await seed_connection_resume_event(fixture, {
      created_at: '2026-07-11T10:00:00.000Z',
      instruction: 'Summarize my last five emails.',
    });
    const run = await create_run(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      session_id: fixture.session.session_id,
      agent_id: fixture.bootstrap.agent_id,
      trigger_type: 'api',
      actor_id: fixture.bootstrap.user_id,
    });
    await update_run_status(fixture.db, {
      run_id: run.run_id,
      run_status: 'completed',
      actor_id: fixture.bootstrap.user_id,
    });
    const [event_job] = await fixture.db
      .insert(event_jobs)
      .values({
        job_id: 'job_connection_resume_completed_replay',
        workspace_id: fixture.bootstrap.workspace_id,
        event_id: event.event_id,
        queue_key: event.queue_key,
        job_handler: 'connection_resume',
        job_status: 'running',
        run_id: run.run_id,
        metadata: {},
        created_by: 'test',
        last_updated_by: 'test',
      })
      .returning();
    if (!event_job) throw new Error('failed to seed connection resume replay event job');

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      event_jobs: [event_job],
      events: [event],
      now: new Date('2026-07-11T11:00:00.000Z'),
    });

    expect(result).toMatchObject({
      job_status: 'done',
      run_id: run.run_id,
      result_data: {
        resumed: true,
        surface: 'chat',
        session_id: fixture.session.session_id,
        run_id: run.run_id,
        connection_ids: ['conn_app'],
        recovered_started_run: true,
      },
    });
    expect(orchestrator.start_run).not.toHaveBeenCalled();
    expect(slack_turn.start).not.toHaveBeenCalled();
  });

  it('enqueues once per connection on the original Slack thread subject', async () => {
    const fixture = await create_fixture();

    const first = await enqueue_connection_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_gmail',
      actor_id: fixture.bootstrap.user_id,
      setup_state: resume_setup_state(fixture.session.session_id),
    });
    const second = await enqueue_connection_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_gmail',
      actor_id: fixture.bootstrap.user_id,
      setup_state: resume_setup_state(fixture.session.session_id),
    });

    const jobs = await fixture.db.query.event_jobs.findMany({
      where: (table, { eq }) => eq(table.job_handler, 'connection_resume'),
    });
    expect(first).toMatchObject({
      enqueued: true,
      queue_key: 'slack:T123:C123:thread:1700000000.000001',
    });
    expect(second).toMatchObject({ enqueued: false });
    expect(jobs).toHaveLength(1);
  });

  it('enqueues chat sessions on the session queue when there is no Slack thread', async () => {
    const fixture = await create_chat_fixture();

    const result = await enqueue_connection_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_gmail',
      actor_id: fixture.bootstrap.user_id,
      setup_state: resume_setup_state(fixture.session.session_id),
    });

    expect(result).toMatchObject({
      enqueued: true,
      queue_key: `session:${fixture.session.session_id}`,
    });
  });

  it('resumes chat sessions with a hidden prompt so the work is waiting when the user returns', async () => {
    const fixture = await create_chat_fixture();
    const record_started_run_id = vi.fn(async () => undefined);
    const event = await seed_connection_resume_event(fixture, {
      actor_id: fixture.bootstrap.user_id,
      created_at: new Date().toISOString(),
      instruction: 'Summarize my last five emails.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
      record_started_run_id,
    });

    expect(result).toMatchObject({
      job_status: 'done',
      run_id: 'run_chat_resume',
      result_data: {
        resumed: true,
        surface: 'chat',
        session_id: fixture.session.session_id,
      },
    });
    expect(slack_turn.start).not.toHaveBeenCalled();
    expect(orchestrator.start_run).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        session_id: fixture.session.session_id,
        user_message: expect.stringContaining('Summarize my last five emails.'),
        user_message_is_user_visible: false,
        actor_id: fixture.bootstrap.user_id,
      }),
      expect.objectContaining({ on_stream_event: expect.any(Function) }),
    );
    expect(record_started_run_id).toHaveBeenCalledWith('run_chat_resume');
  });

  it('keeps an OAuth-resumed scout run hidden while its normal tools continue working', async () => {
    const fixture = await create_chat_fixture();
    const session = await create_session(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      agent_id: fixture.bootstrap.agent_id,
      session_source: 'trigger',
      external_thread_key: `${agent_heartbeat_session_thread_prefix}:trg_test`,
      source_metadata: {
        kind: agent_heartbeat_session_kind,
        runtime_response_is_user_visible: false,
      },
      actor_id: fixture.bootstrap.user_id,
    });
    const event = await seed_connection_resume_event(
      { ...fixture, session },
      {
        created_at: new Date().toISOString(),
        instruction:
          'Send the requested email, then report with slack-send_message-1 to user U_REQUESTER.',
      },
    );

    await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
    });

    expect(orchestrator.start_run).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        session_id: session.session_id,
        source_type: 'runtime',
        runtime_response_is_user_visible: false,
        user_message_is_user_visible: false,
      }),
      expect.any(Object),
    );
  });

  it('skips a second connection whose instruction a finished resume already delivered', async () => {
    const fixture = await create_chat_fixture();
    const instruction = 'Summarize my last five emails.';
    const created_at = new Date(Date.now() - 60_000).toISOString();
    await deliver_resume_message(fixture, { instruction });
    const notion_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_notion',
      created_at,
      instruction,
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [notion_event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: false, code: 'resume_already_delivered' },
    });
    expect(orchestrator.start_run).not.toHaveBeenCalled();
  });

  it('skips a Slack second connection too, where the resume prompt stays visible', async () => {
    const fixture = await create_fixture();
    await seed_slack_connection(fixture);
    const instruction = 'List my Notion pages.';
    await deliver_resume_message(fixture, { instruction, is_user_visible: true });
    const event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_notion',
      created_at: new Date(Date.now() - 60_000).toISOString(),
      instruction,
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: false, code: 'resume_already_delivered' },
    });
    expect(slack_turn.start).not.toHaveBeenCalled();
  });

  it('still resumes an ask created after the last delivered resume', async () => {
    const fixture = await create_chat_fixture();
    const instruction = 'Summarize my last five emails.';
    await deliver_resume_message(fixture, { instruction });
    const event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_notion',
      created_at: new Date().toISOString(),
      instruction,
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({ job_status: 'done', result_data: { resumed: true } });
    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
  });

  it('lets a busy-session conflict escape so the runner requeues instead of failing the resume', async () => {
    const fixture = await create_chat_fixture();
    orchestrator.start_run.mockRejectedValueOnce(new ConflictError('Session is busy'));
    const event = await seed_connection_resume_event(fixture, {
      created_at: new Date().toISOString(),
      instruction: 'Summarize my last five emails.',
    });

    await expect(
      run_connection_resume_job({
        db: fixture.db,
        workspace_id: fixture.bootstrap.workspace_id,
        events: [event],
      }),
    ).rejects.toThrow('Session is busy');
  });

  it('resumes the latest connection event through the Slack channel turn service', async () => {
    const fixture = await create_fixture();
    await seed_slack_connection(fixture);
    const event = await seed_connection_resume_event(fixture, {
      created_at: new Date().toISOString(),
      instruction: 'List my Notion pages.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      run_id: 'run_resume',
      result_data: {
        resumed: true,
        session_id: 'ses_slack',
        channel_id: 'C123',
        thread_ts: '1700000000.000001',
      },
    });
    expect(slack_turn.start).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        workspace_id: fixture.bootstrap.workspace_id,
        agent_id: fixture.bootstrap.agent_id,
        actor_id: 'system:connection_resume',
        connection_id: 'conn_slack',
        known_thread_reply: true,
        starting_message: {
          text: '✅ Connection connected — on it.',
          idempotency_key: expect.stringMatching(/^connection_resume:/u),
        },
        message: expect.objectContaining({
          team_id: 'T123',
          channel_id: 'C123',
          thread_ts: '1700000000.000001',
          user_id: 'U123',
          text: expect.stringContaining('List my Notion pages.'),
        }),
      }),
    );
  });

  it('merges multiple connection resume events on the same Slack thread into one turn', async () => {
    const fixture = await create_fixture();
    await seed_slack_connection(fixture);
    const first = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_gmail',
      created_at: new Date().toISOString(),
      instruction: 'Summarize my latest Gmail messages.',
    });
    const second = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_notion',
      created_at: new Date().toISOString(),
      instruction: 'List my Notion pages.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [first, second],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: {
        resumed: true,
        connection_ids: ['conn_gmail', 'conn_notion'],
      },
    });
    expect(slack_turn.start).toHaveBeenCalledTimes(1);
    expect(slack_turn.start).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        message: expect.objectContaining({
          text: expect.stringContaining('1. Summarize my latest Gmail messages.'),
        }),
      }),
    );
    expect(slack_turn.start).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        message: expect.objectContaining({
          text: expect.stringContaining('2. List my Notion pages.'),
        }),
      }),
    );
  });

  it('resumes a single-connection task immediately, with no sibling to wait for', async () => {
    const fixture = await create_chat_fixture();
    const batch_id = await create_finished_origin_run(fixture);
    const event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_gmail',
      batch_id,
      created_at: new Date().toISOString(),
      instruction: 'Summarize my last five emails.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: true, connection_ids: ['conn_gmail'] },
    });
    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
  });

  it('waits for every connection requested by the originating run before resuming', async () => {
    const fixture = await create_chat_fixture();
    const batch_id = await create_finished_origin_run(fixture);
    await seed_pending_resume_connection(fixture, {
      connection_id: 'conn_notion',
      batch_id,
    });
    const gmail_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_gmail',
      batch_id,
      created_at: new Date().toISOString(),
      instruction: 'Summarize Gmail and save the result in Notion.',
    });

    const waiting = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [gmail_event],
    });

    expect(waiting).toMatchObject({
      job_status: 'done',
      result_data: { resumed: false, code: 'resume_batch_waiting' },
    });
    expect(orchestrator.start_run).not.toHaveBeenCalled();

    await fixture.db
      .update(connections)
      .set({ connection_status: 'active', setup_state: {} })
      .where(eq(connections.connection_id, 'conn_notion'));
    const notion_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_notion',
      batch_id,
      created_at: new Date().toISOString(),
      instruction: 'Summarize Gmail and save the result in Notion.',
    });

    const resumed = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [gmail_event, notion_event],
    });

    expect(resumed).toMatchObject({
      job_status: 'done',
      result_data: {
        resumed: true,
        connection_ids: ['conn_gmail', 'conn_notion'],
      },
    });
    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
  });

  it('treats Not now as a resolved connection choice and continues without that connection', async () => {
    const fixture = await create_chat_fixture();
    const batch_id = await create_finished_origin_run(fixture);
    await seed_pending_resume_connection(fixture, {
      connection_id: 'conn_notion',
      batch_id,
    });
    const gmail_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_gmail',
      batch_id,
      created_at: new Date().toISOString(),
      instruction: 'Summarize Gmail and save the result in Notion.',
    });
    const postponed = await postpone_pending_connection_resume(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_notion',
      actor_id: fixture.bootstrap.user_id,
    });
    if (!postponed.setup_state) throw new Error('pending connection was not postponed');
    const notion_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_notion',
      batch_id,
      resolution: 'postponed',
      created_at: new Date().toISOString(),
      instruction: 'Summarize Gmail and save the result in Notion.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [gmail_event, notion_event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: true, connection_ids: ['conn_gmail'] },
    });
    expect(orchestrator.start_run).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        user_message: expect.stringContaining('do not ask again'),
      }),
      expect.any(Object),
    );
  });

  it('treats dismissing a request with × as a resolved choice and releases the batch', async () => {
    const fixture = await create_chat_fixture();
    const batch_id = await create_finished_origin_run(fixture);
    await seed_pending_resume_connection(fixture, {
      connection_id: 'conn_notion',
      batch_id,
    });
    const gmail_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_gmail',
      batch_id,
      created_at: new Date().toISOString(),
      instruction: 'Summarize Gmail and save the result in Notion.',
    });
    const cancelled = await cancel_pending_connection_setup(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      connection_id: 'conn_notion',
      actor_id: fixture.bootstrap.user_id,
    });
    if (!cancelled.cancelled) throw new Error('pending connection was not cancelled');
    const notion_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_notion',
      batch_id,
      resolution: 'cancelled',
      created_at: new Date().toISOString(),
      instruction: 'Summarize Gmail and save the result in Notion.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [gmail_event, notion_event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: true, connection_ids: ['conn_gmail'] },
    });
    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
    expect(orchestrator.start_run).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        user_message: expect.stringContaining('do not ask again'),
      }),
      expect.any(Object),
    );
  });

  it('treats an ignored request that timed out as a resolved choice and resumes anyway', async () => {
    const fixture = await create_chat_fixture();
    const batch_id = await create_finished_origin_run(fixture);
    await seed_pending_resume_connection(fixture, {
      connection_id: 'conn_notion',
      batch_id,
    });
    const gmail_event = await seed_connection_resume_event(fixture, {
      connection_id: 'conn_gmail',
      batch_id,
      created_at: new Date().toISOString(),
      instruction: 'Summarize Gmail and save the result in Notion.',
    });

    const waiting = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [gmail_event],
    });
    expect(waiting).toMatchObject({
      job_status: 'done',
      result_data: { resumed: false, code: 'resume_batch_waiting' },
    });
    expect(orchestrator.start_run).not.toHaveBeenCalled();

    const expired = await expire_stale_pending_connection_setups(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      expiry_ms: 0,
      actor_id: 'system:connection_setup_expiry',
    });
    await start_resumes_for_expired_connection_setups(fixture.db, expired);

    const notion_event = await fixture.db.query.events.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.source, 'connection'), eq(table.source_event_id, 'conn_notion')),
    });
    expect(notion_event?.event_body).toMatchObject({
      connection_id: 'conn_notion',
      connection_resolution: 'expired',
      resume: { batch_id, session_id: fixture.session.session_id },
    });
    if (!notion_event) throw new Error('the expiry sweep did not enqueue a resume');

    const resumed = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [gmail_event, notion_event],
    });

    expect(resumed).toMatchObject({
      job_status: 'done',
      result_data: { resumed: true, connection_ids: ['conn_gmail'] },
    });
    expect(orchestrator.start_run).toHaveBeenCalledWith(
      fixture.db,
      expect.objectContaining({
        user_message: expect.stringContaining('do not ask again'),
      }),
      expect.any(Object),
    );
  });

  it('gives the resume intent a longer life than the setup link it waits on', () => {
    expect(connection_resume_expiry_ms).toBeGreaterThan(pending_connection_setup_expiry_ms);
    expect(connection_resume_expiry_ms).toBe(30 * 60 * 1000);
  });

  it('skips expired resume intents without starting a run', async () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    const fixture = await create_fixture();
    await seed_slack_connection(fixture);
    const event = await seed_connection_resume_event(fixture, {
      created_at: new Date(now.getTime() - connection_resume_expiry_ms).toISOString(),
      instruction: 'Old task.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
      now,
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: false, code: 'resume_intent_expired' },
    });
    expect(slack_turn.start).not.toHaveBeenCalled();
  });

  it('skips when the active Slack connection belongs to a different team than the resume target', async () => {
    const fixture = await create_fixture();
    await seed_slack_connection(fixture, { team_id: 'T_OTHER' });
    const event = await seed_connection_resume_event(fixture, {
      created_at: new Date().toISOString(),
      instruction: 'List pages.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: false, code: 'resume_slack_missing' },
    });
    expect(slack_turn.start).not.toHaveBeenCalled();
  });

  it('skips when the workspace has no active Slack connection', async () => {
    const fixture = await create_fixture();
    const event = await seed_connection_resume_event(fixture, {
      created_at: new Date().toISOString(),
      instruction: 'List pages.',
    });

    const result = await run_connection_resume_job({
      db: fixture.db,
      workspace_id: fixture.bootstrap.workspace_id,
      events: [event],
    });

    expect(result).toMatchObject({
      job_status: 'done',
      result_data: { resumed: false, code: 'resume_slack_missing' },
    });
    expect(slack_turn.start).not.toHaveBeenCalled();
  });
});

async function create_chat_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  return { db, bootstrap, session };
}

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    session_source: 'slack',
    external_thread_key: 'slack:T123:C123:thread:1700000000.000001',
    source_metadata: {
      slack: {
        team_id: 'T123',
        channel_id: 'C123',
        channel_type: 'channel',
        conversation_scope: 'thread',
        thread_ts: '1700000000.000001',
      },
    },
    actor_id: bootstrap.user_id,
  });
  await upsert_session_source_actor(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    source_actor: create_external_source_actor({
      provider_key: 'slack',
      external_account_id: 'T123',
      external_user_id: 'U123',
      profile: { display_name: 'Robin' },
    }),
    actor_id: bootstrap.user_id,
  });

  return { db, bootstrap, session };
}

async function seed_slack_connection(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  input: { team_id?: string } = {},
) {
  const team_id = input.team_id ?? 'T123';
  const slack_app = await fixture.db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  if (!slack_app) throw new Error('Slack app was not seeded');

  await fixture.db.insert(connections).values({
    connection_id: 'conn_slack',
    workspace_id: fixture.bootstrap.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Slack',
    connection_status: 'active',
    connection_key: 'native:slack:resume',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: team_id,
    external_account_name: 'Test workspace',
    authorized_scopes: ['chat:write'],
    health_status: 'healthy',
    provider_account: { team_id, bot_user_id: 'B123' },
    created_by: fixture.bootstrap.user_id,
    last_updated_by: fixture.bootstrap.user_id,
  });
}

async function deliver_resume_message(
  fixture: Awaited<ReturnType<typeof create_chat_fixture>>,
  input: { instruction: string; is_user_visible?: boolean },
) {
  const run = await create_run(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    agent_id: fixture.bootstrap.agent_id,
    trigger_type: 'api',
    actor_id: fixture.bootstrap.user_id,
  });
  await create_run_message(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    run_id: run.run_id,
    message_role: 'user',
    message_content: {
      type: 'text',
      text: `The connection the user just set up is now active. Continue the task they were waiting on: ${input.instruction}`,
    },
    is_user_visible: input.is_user_visible ?? false,
    source_type: 'runtime',
    actor_id: fixture.bootstrap.user_id,
  });
  await update_run_status(fixture.db, {
    run_id: run.run_id,
    run_status: 'completed',
    actor_id: fixture.bootstrap.user_id,
  });
  return run;
}

async function seed_connection_resume_event(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  input: {
    instruction: string;
    created_at: string;
    actor_id?: string;
    batch_id?: string;
    connection_id?: string;
    resolution?: 'connected' | 'postponed' | 'cancelled';
  },
) {
  const connection_id = input.connection_id ?? 'conn_app';
  const [event] = await fixture.db
    .insert(events)
    .values({
      event_id: `evt_${connection_id}_${input.resolution ?? 'connected'}`,
      workspace_id: fixture.bootstrap.workspace_id,
      source: 'connection',
      source_event_id: connection_id,
      event_type: 'connection.resume_requested',
      queue_key: fixture.session.external_thread_key ?? 'missing',
      actor_key: fixture.bootstrap.user_id,
      event_body: {
        connection_id,
        connection_resolution: input.resolution ?? 'connected',
        resume: {
          session_id: fixture.session.session_id,
          ...(input.batch_id ? { batch_id: input.batch_id } : {}),
          ...(input.actor_id ? { actor_id: input.actor_id } : {}),
          instruction: input.instruction,
          created_at: input.created_at,
        },
      },
      created_by: fixture.bootstrap.user_id,
      last_updated_by: fixture.bootstrap.user_id,
    })
    .returning();
  if (!event) throw new Error('Event was not inserted');
  return event;
}

async function create_finished_origin_run(
  fixture: Awaited<ReturnType<typeof create_chat_fixture>>,
) {
  const run = await create_run(fixture.db, {
    workspace_id: fixture.bootstrap.workspace_id,
    session_id: fixture.session.session_id,
    agent_id: fixture.bootstrap.agent_id,
    trigger_type: 'api',
    actor_id: fixture.bootstrap.user_id,
  });
  await update_run_status(fixture.db, {
    run_id: run.run_id,
    run_status: 'completed',
    actor_id: fixture.bootstrap.user_id,
  });
  return run.run_id;
}

async function seed_pending_resume_connection(
  fixture: Awaited<ReturnType<typeof create_chat_fixture>>,
  input: { connection_id: string; batch_id: string },
) {
  await fixture.db.insert(connections).values({
    connection_id: input.connection_id,
    workspace_id: fixture.bootstrap.workspace_id,
    app_id: 'app_test',
    connection_name: input.connection_id,
    connection_status: 'pending_setup',
    connection_key: `test:${input.connection_id}`,
    provider_key: 'test',
    provider_config_key: 'test',
    provider_config_version: 1,
    connection_profile_key: 'test',
    connection_profile_version: 1,
    auth_method_key: 'oauth2',
    setup_state: {
      resume: {
        session_id: fixture.session.session_id,
        batch_id: input.batch_id,
        instruction: 'Summarize Gmail and save the result in Notion.',
        created_at: new Date().toISOString(),
      },
    },
    created_by: fixture.bootstrap.user_id,
    last_updated_by: fixture.bootstrap.user_id,
  });
}

function resume_setup_state(session_id: string) {
  return {
    resume: {
      session_id,
      instruction: 'Continue the interrupted task.',
      created_at: new Date().toISOString(),
    },
  };
}
