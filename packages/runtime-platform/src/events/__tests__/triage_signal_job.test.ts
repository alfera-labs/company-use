import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_notifications_page } from '@coworker/core/db/queries/notification_outcomes';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { automations, event_jobs, events } from '@coworker/core/db/schema';
import type {
  AutomationConditions,
  AutomationJudge,
} from '@coworker/core/db/schema/automation_contracts';
import { AppError } from '@coworker/shared';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start_agent_run = vi.fn(async (_db: Database, _input: StartAgentRunInput) => ({
  run_id: 'run_test',
  run_status: 'completed',
}));
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const model_answer = vi.hoisted(() => ({
  value: {
    important_now: 0.9,
    importance_reason: 'the invoice is due on Friday and nobody has paid it',
    urgency: 'deadline',
    could_automate: true,
    automation_sentence: 'when an invoice arrives, file it and tell me before it is due',
    subject: 'invoice 4471',
    claim: 'is due on Friday',
  } as Record<string, unknown>,
}));
const generate_object = vi.fn(async (input: { parse?: (value: unknown) => unknown }) => ({
  object: input.parse ? input.parse(model_answer.value) : model_answer.value,
  text: JSON.stringify(model_answer.value),
}));
vi.mock('@agent-core/llm_gateway', () => ({ create_llm_gateway: () => ({ generate_object }) }));

const attention_file = vi.hoisted(() => ({ text: null as string | null }));
vi.mock('@runtime-platform/files/workspace_volume_browser', () => ({
  resolve_workspace_volume_address: async () => ({
    volume_id: 'vol_test',
    provider_volume_id: 'pv_test',
    region: undefined,
    volume_workspace_path: 'agents/agt_test',
    layout: 'workspace_v1',
  }),
  read_workspace_volume_file: async () => {
    if (attention_file.text === null) {
      throw new AppError('workspace_file_not_found', 'That file no longer exists.', 404);
    }
    return new TextEncoder().encode(attention_file.text);
  },
  write_workspace_volume_file: async () => undefined,
  replace_workspace_volume_file: async () => undefined,
}));

const { run_triage_signal_job, triage_signal_job_handler } = await import(
  '@runtime-platform/events/triage_signal_job'
);
const { run_automation_job } = await import('@runtime-platform/events/run_automation_job');
const { forget_notification_rules_file } = await import(
  '@runtime-platform/notifications/notification_rules_file'
);
const { default_email_conditions } = await import(
  '@runtime-platform/tools/definitions/automations_condition_defaults'
);
const { automation_session_key } = await import('@runtime-platform/automations/automation_subject');

type Db = Awaited<ReturnType<typeof create_test_database>>;

function written_policy(lines: string[] = []) {
  return ['---', 'dial: normal', 'quiet_hours: null', ...lines, '---', '', 'Money matters.'].join(
    '\n',
  );
}

const newsletter = {
  id: 'msg_2',
  thread_id: 'thr_news',
  sender: 'no-reply@newsletter.example.com',
  subject: 'This week in billing',
  payload: { headers: [{ name: 'List-Unsubscribe', value: '<mailto:x@example.com>' }] },
};

const invoice = {
  id: 'msg_1',
  thread_id: 'thr_invoice',
  sender: 'billing@vendor.example.com',
  subject: 'Invoice 4471 is due Friday',
  payload: { headers: [{ name: 'Received', value: 'by mx' }] },
};

async function seed_workspace(db: Db) {
  const bootstrap = await bootstrap_default_workspace(db);
  await db.insert(automations).values({
    automation_id: 'atm_1',
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    automation_name: 'Answer billing questions',
    automation_status: 'enabled',
    instruction: 'Draft a reply and show it to me.',
    uses_tools: { apps: ['gmail'] },
    run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [],
    judge: null,
    created_via: 'user',
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
  return bootstrap;
}

async function triage_the_signal(
  db: Db,
  bootstrap: Awaited<ReturnType<typeof seed_workspace>>,
  data: Record<string, unknown>,
  event_id = 'evt_triage',
) {
  const [event] = await db
    .insert(events)
    .values({
      event_id,
      workspace_id: bootstrap.workspace_id,
      source: 'triage',
      source_event_id: `fire_${event_id}`,
      event_type: 'signal.triage',
      queue_key: `triage:${bootstrap.workspace_id}:thr_1`,
      actor_key: 'system:triage',
      event_body: {
        kind: 'triage_signal',
        agent_id: bootstrap.agent_id,
        automation_id: 'atm_1',
        trigger_id: 'trg_1',
        stage: 'judge',
        fire_event_id: `fire_${event_id}`,
        data,
      },
      created_by: 'system:triage',
      last_updated_by: 'system:triage',
    })
    .returning();
  if (!event) throw new Error('failed to seed the triage event');
  return run_triage_signal_job({ db, workspace_id: bootstrap.workspace_id, events: [event] });
}

async function decisions(db: Db, workspace_id: string) {
  const page = await list_notifications_page(db, { workspace_id, page: 1, page_size: 100 });
  return page.items;
}

describe('run_triage_signal_job', () => {
  beforeEach(() => {
    generate_object.mockClear();
    start_agent_run.mockClear();
    attention_file.text = written_policy();
    model_answer.value = {
      important_now: 0.9,
      importance_reason: 'the invoice is due on Friday and nobody has paid it',
      urgency: 'deadline',
      could_automate: true,
      automation_sentence: 'when an invoice arrives, file it and tell me before it is due',
      subject: 'invoice 4471',
      claim: 'is due on Friday',
    };
  });

  it('stands down when another automation ran on the same subject', async () => {
    const db = await create_test_database();
    const bootstrap = await seed_workspace(db);
    forget_notification_rules_file(bootstrap);
    await db.insert(event_jobs).values({
      job_id: 'ejob_ran_on_it',
      workspace_id: bootstrap.workspace_id,
      queue_key: 'automation:atm_9:subject:thr_1',
      job_handler: 'run_automation',
      job_status: 'done',
      result_data: { ran: true, run_id: 'run_9' },
      created_by: 'system:events',
      last_updated_by: 'system:events',
    });
    const result = await triage_the_signal(db, bootstrap, {
      sender: 'dana@example.com',
      subject: 'Invoice date',
    });
    expect(result.result_data).toMatchObject({ triaged: false, skipped: { stage: 'handled' } });
    expect(generate_object).not.toHaveBeenCalled();
  });

  it('drops a newsletter on the workspace ignore list before it costs a model call', async () => {
    const db = await create_test_database();
    const bootstrap = await seed_workspace(db);
    forget_notification_rules_file(bootstrap);

    const result = await triage_the_signal(db, bootstrap, newsletter);

    expect(result.result_data).toMatchObject({
      triaged: false,
      skipped: { stage: 'rule' },
    });
    expect(generate_object).not.toHaveBeenCalled();
    expect(await decisions(db, bootstrap.workspace_id)).toHaveLength(0);
  });

  it('interrupts with an offer when the signal matters now, and writes the automation idea quietly', async () => {
    const db = await create_test_database();
    const bootstrap = await seed_workspace(db);
    forget_notification_rules_file(bootstrap);

    const result = await triage_the_signal(db, bootstrap, invoice);

    expect(result.result_data).toMatchObject({ triaged: true });
    const rows = await decisions(db, bootstrap.workspace_id);
    const told = rows.find((row) => row.notification.urgency === 'deadline');
    expect(told?.outcome).toBe('notify_now');
    expect(told?.notification).toMatchObject({
      score: 90,
      proposed_action: {
        kind: 'offer_to_act',
        instruction: 'when an invoice arrives, file it and tell me before it is due',
      },
    });
    expect(told?.notification.evidence).toMatchObject({ event_ids: ['fire_evt_triage'] });

    const idea = rows.find((row) => row.notification.urgency === 'fyi');
    expect(idea?.outcome).not.toBe('notify_now');
    expect(idea?.notification).toMatchObject({
      score: 40,
      proposed_action: {
        kind: 'create_automation',
        instruction: 'when an invoice arrives, file it and tell me before it is due',
      },
    });
  });

  it('says nothing when the signal does not matter today, but still offers the automation once', async () => {
    const db = await create_test_database();
    const bootstrap = await seed_workspace(db);
    forget_notification_rules_file(bootstrap);
    model_answer.value = { ...model_answer.value, important_now: 0.3, urgency: 'routine' };

    await triage_the_signal(db, bootstrap, invoice, 'evt_triage_1');
    await triage_the_signal(db, bootstrap, { ...invoice, id: 'msg_9' }, 'evt_triage_2');

    const rows = await decisions(db, bootstrap.workspace_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.notification).toMatchObject({ urgency: 'fyi', score: 40 });
  });

  it('stops asking the model once the day is spent', async () => {
    const db = await create_test_database();
    const bootstrap = await seed_workspace(db);
    attention_file.text = written_policy(['triage_calls_per_day: 1']);
    forget_notification_rules_file(bootstrap);
    await db.insert(event_jobs).values({
      job_id: 'job_spent',
      workspace_id: bootstrap.workspace_id,
      queue_key: 'triage:spent',
      job_handler: triage_signal_job_handler,
      job_status: 'done',
      result_data: { triaged: true },
      created_by: 'system:triage',
      last_updated_by: 'system:triage',
    });

    const result = await triage_the_signal(db, bootstrap, invoice);

    expect(result.result_data).toMatchObject({ triaged: false, skipped: { stage: 'budget' } });
    expect(generate_object).not.toHaveBeenCalled();
  });

  it('looks at the newsletter when the workspace emptied its ignore list', async () => {
    const db = await create_test_database();
    const bootstrap = await seed_workspace(db);
    attention_file.text = written_policy(['ignore: []']);
    forget_notification_rules_file(bootstrap);

    const rules = await default_email_conditions(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      node_keys: [],
    });
    expect(rules).toEqual([]);

    const result = await triage_the_signal(db, bootstrap, newsletter);

    expect(result.result_data).toMatchObject({ triaged: true });
    expect(generate_object).toHaveBeenCalledTimes(1);
  });
});

describe('a fire nobody took', () => {
  beforeEach(() => {
    generate_object.mockClear();
    start_agent_run.mockClear();
    attention_file.text = written_policy();
  });

  async function fire_the_automation(
    db: Db,
    options: { conditions: AutomationConditions; judge: AutomationJudge; listen?: boolean },
  ) {
    const bootstrap = await bootstrap_default_workspace(db);
    await db.insert(automations).values({
      automation_id: 'atm_1',
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      automation_name: 'Answer billing questions',
      automation_status: 'enabled',
      instruction: 'Draft a reply and show it to me.',
      uses_tools: { apps: ['gmail'] },
      run_policy: {
        subject_from: 'thread_id',
        when_a_run_is_already_going: 'wait_for_it_to_finish',
        ...(options.listen ? { listen: true } : {}),
      },
      conditions: options.conditions,
      judge: options.judge,
      created_via: 'user',
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    });
    const trigger = await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_name: 'New mail',
      trigger_type: 'app_event',
      trigger_config: { starts_job_handler: 'run_automation', provisioned_by: 'composio' },
      automation_id: 'atm_1',
      actor_id: bootstrap.user_id,
    });
    const queue_key = automation_session_key('atm_1', 'thr_invoice');
    const [event] = await db
      .insert(events)
      .values({
        event_id: 'evt_fire',
        workspace_id: bootstrap.workspace_id,
        source: 'trigger',
        source_event_id: `${trigger.trigger_id}:msg_1`,
        event_type: 'trigger.fired',
        queue_key,
        actor_key: 'system:trigger',
        event_body: {
          trigger_id: trigger.trigger_id,
          delivery: {
            provider: 'composio',
            trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
            received_time: '2026-09-16T09:04:12Z',
            data: invoice,
          },
        },
        created_by: 'system:trigger',
        last_updated_by: 'system:trigger',
      })
      .returning();
    if (!event) throw new Error('failed to seed the fire');
    const result = await run_automation_job({
      db,
      workspace_id: bootstrap.workspace_id,
      queue_key,
      events: [event],
    });
    const queued = await db.query.event_jobs.findMany({
      where: and(
        eq(event_jobs.workspace_id, bootstrap.workspace_id),
        eq(event_jobs.job_handler, triage_signal_job_handler),
      ),
    });
    return { bootstrap, result, queued };
  }

  it('is queued for triage when the judge turned it away', async () => {
    const db = await create_test_database();
    model_answer.value = { answer: 'no', confidence: 0.95, kind: 'invoice', reason: 'no ticket' };

    const { result, queued } = await fire_the_automation(db, {
      conditions: [],
      judge: { question: 'Is this a customer asking about a refund?' },
    });

    expect(result.result_data).toMatchObject({ skipped: { stage: 'judge' } });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.queue_key).toContain('triage:');
  });

  it('is queued for triage when the ear only listens', async () => {
    const db = await create_test_database();

    const { result, queued } = await fire_the_automation(db, {
      conditions: [],
      judge: null,
      listen: true,
    });

    expect(result.result_data).toMatchObject({ skipped: { stage: 'listen' } });
    expect(queued).toHaveLength(1);
  });

  it('is not queued when a rule dropped it: the person already answered that', async () => {
    const db = await create_test_database();

    const { result, queued } = await fire_the_automation(db, {
      conditions: [{ field: 'sender', operation: 'does_not_contain_any_of', values: ['vendor'] }],
      judge: null,
    });

    expect(result.result_data).toMatchObject({ skipped: { stage: 'rule' } });
    expect(queued).toHaveLength(0);
  });

  it('is not queued when an automation ran on it', async () => {
    const db = await create_test_database();

    const { result, queued } = await fire_the_automation(db, {
      conditions: [],
      judge: null,
    });

    expect(result.result_data).toMatchObject({ ran: true });
    expect(queued).toHaveLength(0);
  });
});
