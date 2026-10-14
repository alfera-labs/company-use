import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { list_notifications_page } from '@coworker/core/db/queries/notification_outcomes';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import {
  automations,
  event_jobs,
  events,
  runs,
  sessions,
  tool_calls,
} from '@coworker/core/db/schema';
import type { AutomationBudget } from '@coworker/core/db/schema/automation_contracts';
import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start_agent_run = vi.fn(async (_db: Database, _input: StartAgentRunInput) => ({
  run_id: 'run_test',
  run_status: 'completed',
}));
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const deliver_to_person = vi.fn(async () => ({
  delivered_on: 'slack_dm' as const,
  delivery_ref: 'D1:1',
  delivery_error: null,
}));
vi.mock('@runtime-platform/delivery/deliver_to_person', async (import_original) => ({
  ...(await import_original<typeof import('@runtime-platform/delivery/deliver_to_person')>()),
  deliver_to_person,
}));

const { run_automation_job } = await import('@runtime-platform/events/run_automation_job');

type Db = Awaited<ReturnType<typeof create_test_database>>;

const automation_id = 'atm_budget';

let db: Db;
let workspace_id: string;
let agent_id: string;
let user_id: string;
let trigger_id: string;

beforeEach(async () => {
  deliver_to_person.mockClear();
  start_agent_run.mockClear();
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;
  user_id = bootstrap.user_id;
});

async function seed_automation(budget: Partial<AutomationBudget>) {
  await db.insert(automations).values({
    automation_id,
    workspace_id,
    agent_id,
    automation_name: 'Chase the vendor',
    automation_status: 'enabled',
    instruction: 'Read the thread and chase it.',
    run_policy: {
      subject_from: 'thread_id',
      when_a_run_is_already_going: 'wait_for_it_to_finish',
      budget: { max_fires_per_day: 50, max_no_progress_runs: 3, ...budget },
    },
    conditions: [],
    judge: null,
    uses_tools: { apps: [] },
    created_via: 'user',
    created_by: user_id,
    last_updated_by: user_id,
  });
  const trigger = await create_trigger(db, {
    workspace_id,
    agent_id,
    trigger_name: 'New mail',
    trigger_type: 'app_event',
    trigger_config: { starts_job_handler: 'run_automation' },
    automation_id,
    actor_id: user_id,
  });
  trigger_id = trigger.trigger_id;
}

async function fire(
  sequence: number,
  data: Record<string, unknown> = {},
  options: { thread?: string; run_the_job?: boolean } = {},
) {
  const thread = options.thread ?? `thread_${sequence}`;
  const [event] = await db
    .insert(events)
    .values({
      event_id: `evt_fire_${sequence}`,
      workspace_id,
      source: 'trigger',
      source_event_id: `${trigger_id}:msg_${sequence}`,
      event_type: 'trigger.fired',
      queue_key: `automation:${automation_id}:subject:${thread}`,
      actor_key: 'system:trigger',
      event_body: {
        trigger_id,
        delivery: {
          provider: 'composio',
          trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
          received_time: '2026-09-16T09:00:00Z',
          data: { id: `msg_${sequence}`, thread_id: thread, ...data },
        },
      },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!event) throw new Error('failed to seed the fire');
  if (options.run_the_job === false) return { job_status: 'queued', result_data: {} } as never;
  return run_automation_job({
    db,
    workspace_id,
    queue_key: `automation:${automation_id}:subject:${thread}`,
    events: [event],
    event_jobs: [],
  });
}

async function read_automation() {
  const [row] = await db
    .select()
    .from(automations)
    .where(eq(automations.automation_id, automation_id));
  return row;
}

async function read_pause_notifications() {
  const page = await list_notifications_page(db, { workspace_id, page: 1, page_size: 100 });
  return page.items.filter((row) => row.notification.title.includes('paused:'));
}

describe('automation budgets', () => {
  it('pauses the automation and says so once when it runs past its fires for the day', async () => {
    await seed_automation({ max_fires_per_day: 2 });

    await fire(1);
    await fire(2);
    const third = await fire(3);

    expect(third.result_data).toMatchObject({
      ran: false,
      code: 'automation_over_budget',
      budget_limit: 2,
    });
    expect((await read_automation())?.automation_status).toBe('paused');
    const notifications = await read_pause_notifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.notification.title).toBe(
      'Automation Chase the vendor paused: it fired 3 times today, past its budget of 2',
    );
    expect(notifications[0]?.notification.urgency).toBe('system_problem');
    expect(start_agent_run).toHaveBeenCalledTimes(2);
  });

  it('pauses the automation when its runs change nothing three times in a row', async () => {
    await seed_automation({ max_no_progress_runs: 3 });

    await fire(1);
    await fire(2);
    expect((await read_automation())?.automation_status).toBe('enabled');
    expect((await read_automation())?.metadata.no_progress_streak).toBe(2);
    await fire(3);

    expect((await read_automation())?.automation_status).toBe('paused');
    expect((await read_pause_notifications())[0]?.notification.title).toBe(
      'Automation Chase the vendor paused: 3 runs in a row changed nothing',
    );
  });

  it('starts the streak over on a run that actually changed something', async () => {
    await seed_automation({ max_no_progress_runs: 3 });
    await fire(1);
    await fire(2);
    start_agent_run.mockImplementationOnce(async () => {
      await db.insert(tool_calls).values({
        tool_call_id: 'tc_send',
        workspace_id,
        session_id: 'ses_any',
        run_id: 'run_test',
        tool_name: 'gmail-send_email-1',
        tool_status: 'completed',
        risk_class: 'send',
        created_by: 'system:trigger',
        last_updated_by: 'system:trigger',
      });
      return { run_id: 'run_test', run_status: 'completed' };
    });

    await fire(3);

    expect((await read_automation())?.automation_status).toBe('enabled');
    expect((await read_automation())?.metadata.no_progress_streak).toBeUndefined();
  });

  it('forgives the streak when a person turns the automation back on', async () => {
    await seed_automation({ max_no_progress_runs: 2 });
    await fire(1);
    await fire(2);
    expect((await read_automation())?.automation_status).toBe('paused');

    await read_automation_lifecycle().set_automation_status(db, {
      workspace_id,
      automation_id,
      automation_status: 'enabled',
      actor_id: user_id,
    });

    expect((await read_automation())?.metadata.no_progress_streak).toBeUndefined();
  });
});

describe('a person turning a paused automation back on', () => {
  it('starts its fires for the day over, so the next fire runs', async () => {
    await seed_automation({ max_fires_per_day: 2 });
    await fire(1);
    await fire(2);
    await fire(3);
    expect((await read_automation())?.automation_status).toBe('paused');

    await read_automation_lifecycle().set_automation_status(db, {
      workspace_id,
      automation_id,
      automation_status: 'enabled',
      actor_id: user_id,
    });
    const next = await fire(4);

    expect(next.result_data).toMatchObject({ ran: true });
    expect((await read_automation())?.automation_status).toBe('enabled');
  });
});

describe('the person s own mail', () => {
  it('starts no run on a new subject the person sent themselves', async () => {
    await seed_automation({});
    const result = await fire(1, { label_ids: ['SENT', 'INBOX'] });
    expect(start_agent_run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain('their own mail starts no run');
  });
});

describe('the person s reply that has not been processed yet', () => {
  it('still hands the thread over when the customer s next mail is processed first', async () => {
    await seed_automation({});
    const first = await fire(1, {}, { thread: 'thr_shared' });
    expect(JSON.stringify(first)).toContain('"ran":true');
    await fire(2, { label_ids: ['SENT', 'INBOX'] }, { thread: 'thr_shared', run_the_job: false });
    const customer = await fire(3, { label_ids: ['INBOX'] }, { thread: 'thr_shared' });
    expect(JSON.stringify(customer)).toContain('"stage":"human"');
  });

  it('does not read the agent s own approved send as the person taking over', async () => {
    await seed_automation({});
    await fire(1, {}, { thread: 'thr_own' });
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.external_thread_key, `automation:${automation_id}:subject:thr_own`));
    if (!session) throw new Error('the first fire opened no session');
    await db.insert(tool_calls).values({
      tool_call_id: 'tc_approved_send',
      workspace_id,
      session_id: session.session_id,
      run_id: 'run_test',
      tool_name: 'gmail-send_email-1',
      tool_status: 'completed',
      risk_class: 'send',
      output_data: { data: { id: '19a0c0ffee', threadId: 'thr_own', labelIds: ['SENT'] } },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    });

    const own = await fire(2, { id: '19a0c0ffee', label_ids: ['SENT'] }, { thread: 'thr_own' });

    expect(JSON.stringify(own)).not.toContain('"stage":"human"');
    const [after] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.session_id, session.session_id));
    expect(JSON.stringify(after?.session_metadata)).not.toContain('human_took_over_time');
  });

  it('never reads the person s reply on thread 123 as a reply on thread 12', async () => {
    await seed_automation({});
    await fire(1, {}, { thread: '12' });
    await fire(2, { label_ids: ['SENT', 'INBOX'] }, { thread: '123', run_the_job: false });
    const next = await fire(3, { label_ids: ['INBOX'] }, { thread: '12' });
    expect(next.result_data).toMatchObject({ ran: true });
  });
});

async function retry_a_job_whose_run_ended(sequence: number, run_status: 'completed' | 'failed') {
  const session = await create_session(db, { workspace_id, agent_id, actor_id: user_id });
  const run = await create_run(db, {
    workspace_id,
    session_id: session.session_id,
    agent_id,
    trigger_type: 'api',
    actor_id: user_id,
  });
  await db.update(runs).set({ run_status }).where(eq(runs.run_id, run.run_id));
  const thread = `thread_${sequence}`;
  const queued = await enqueue_event_jobs(db, {
    workspace_id,
    source: 'test',
    source_event_id: `retried-${sequence}`,
    event_type: 'test.retried',
    queue_key: `automation:${automation_id}:subject:${thread}`,
    actor_key: user_id,
    event_jobs: [{ job_handler: 'run_automation' }],
  });
  const [job] = await db
    .update(event_jobs)
    .set({ run_id: run.run_id })
    .where(eq(event_jobs.job_id, queued.event_jobs[0]?.job_id ?? ''))
    .returning();
  if (!job) throw new Error('failed to seed the retried job');
  await fire(sequence, {}, { run_the_job: false });
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.event_id, `evt_fire_${sequence}`));
  if (!event) throw new Error('failed to read the fire');
  const retry = () =>
    run_automation_job({
      db,
      workspace_id,
      queue_key: `automation:${automation_id}:subject:${thread}`,
      events: [event],
      event_jobs: [job],
    });
  return { run, session, retry };
}

describe('a job retried after its run already happened', () => {
  it('adopts a failed run that already sent a mail instead of sending it again', async () => {
    await seed_automation({});
    const { run, session, retry } = await retry_a_job_whose_run_ended(1, 'failed');
    await db.insert(tool_calls).values({
      tool_call_id: 'tc_sent_before_529',
      workspace_id,
      session_id: session.session_id,
      run_id: run.run_id,
      tool_name: 'gmail-send_email-1',
      tool_status: 'completed',
      risk_class: 'send',
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    });

    const result = await retry();

    expect(start_agent_run.mock.calls.length).toBe(0);
    expect(result).toMatchObject({
      job_status: 'done',
      run_id: run.run_id,
      result_data: { recovered_started_run: true, failed: true },
    });
  });

  it('answers with the run it already made before asking the budget again', async () => {
    await seed_automation({ max_fires_per_day: 1 });
    await fire(1, {}, { run_the_job: false });
    const { run, retry } = await retry_a_job_whose_run_ended(2, 'completed');

    const result = await retry();

    expect(result).toMatchObject({
      run_id: run.run_id,
      result_data: { recovered_started_run: true },
    });
    expect((await read_automation())?.automation_status).toBe('enabled');
    expect(await read_pause_notifications()).toHaveLength(0);
  });
});
