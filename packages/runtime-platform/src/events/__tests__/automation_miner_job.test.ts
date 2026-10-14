import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  append_notification_follow_up,
  list_notifications_page,
  record_notification_outcome,
} from '@coworker/core/db/queries/notification_outcomes';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events, run_messages, runs } from '@coworker/core/db/schema';
import { normalize_ask } from '@runtime-platform/miner/group_recurring_asks';
import { notification_fingerprint } from '@runtime-platform/notifications/notification_body';
import { keep_notifications_person_reads } from '@runtime-platform/tools/notification_readers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generate_object = vi.fn(async () => ({
  object: {
    automation_sentence: 'every Friday, compile the weekly lead list and post it to sales',
    trigger_kind: 'schedule',
    cron_or_node_key: '0 9 * * FRI',
    confidence: 0.9,
  },
}));
vi.mock('@agent-core/llm_gateway', () => ({
  create_llm_gateway: () => ({ generate_object }),
}));

const { mined_ask_subject, recurring_ask_claim, run_automation_miner_job } = await import(
  '@runtime-platform/events/automation_miner_job'
);

const sunday_evening = new Date('2026-09-20T18:00:00Z');
const the_ask = 'Pull the weekly lead list and post it to sales';
const three_fridays = ['2026-09-04', '2026-09-11', '2026-09-18'];

let db: Awaited<ReturnType<typeof create_test_database>>;
let workspace_id: string;
let agent_id: string;
let fired_event: typeof events.$inferSelect;

beforeEach(async () => {
  generate_object.mockClear();
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;

  const trigger = await create_trigger(db, {
    workspace_id,
    agent_id,
    trigger_name: 'Automation miner',
    trigger_type: 'schedule',
    schedule_expression: '0 18 * * SUN',
    trigger_config: {
      starts_job_handler: 'run_automation_miner',
      provisioning_key: 'automation_miner_v1',
    },
    trigger_source: { kind: 'system', source: 'test', purpose: 'automation_miner' },
    actor_id: bootstrap.user_id,
  });
  const [row] = await db
    .insert(events)
    .values({
      event_id: 'evt_miner_fire',
      workspace_id,
      source: 'trigger',
      source_event_id: `${trigger.trigger_id}:2026-09-20T18:00`,
      event_type: 'trigger.fired',
      queue_key: `trigger:${trigger.trigger_id}`,
      actor_key: 'system:trigger',
      event_body: { trigger_id: trigger.trigger_id },
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    })
    .returning();
  if (!row) throw new Error('the fire event was not seeded');
  fired_event = row;
});

async function seed_ask(
  db_handle: Database,
  input: { ask_text: string; day: string; created_by?: string },
) {
  const run_id = `run_${input.day}_${input.created_by ?? 'person'}`;
  const actor = input.created_by ?? 'usr_person';
  await db_handle.insert(runs).values({
    run_id,
    workspace_id,
    session_id: 'ses_chat',
    agent_id,
    run_status: 'completed',
    trigger_type: 'user_message',
    created_time: new Date(`${input.day}T10:00:00Z`),
    created_by: actor,
    last_updated_by: actor,
  });
  await db_handle.insert(run_messages).values({
    run_message_id: `msg_${run_id}`,
    workspace_id,
    session_id: 'ses_chat',
    run_id,
    message_role: 'user',
    message_kind: 'text',
    message_content: { text: input.ask_text },
    content_text: input.ask_text,
    message_sequence: Number(input.day.replaceAll('-', '').slice(4)),
    run_message_sequence: 1,
    created_by: actor,
    last_updated_by: actor,
  });
}

async function seed_the_habit(created_by?: string) {
  for (const day of three_fridays) {
    await seed_ask(db, { ask_text: the_ask, day, ...(created_by ? { created_by } : {}) });
  }
}

function run_the_miner() {
  return run_automation_miner_job({ db, workspace_id, events: [fired_event], now: sunday_evening });
}

async function list_ideas() {
  const page = await list_notifications_page(db, { workspace_id, page: 1, page_size: 100 });
  return page.items;
}

describe('run_automation_miner_job', () => {
  it('parks one idea for the habit, and asks the model exactly once', async () => {
    await seed_the_habit();
    await seed_ask(db, { ask_text: 'Book the meeting room for the board', day: '2026-09-15' });

    const result = await run_the_miner();
    const ideas = await list_ideas();

    expect(result.result_data).toMatchObject({ ran: true, candidates: 1 });
    expect(generate_object).toHaveBeenCalledTimes(1);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.outcome).toBe('add_to_ideas_list');
    expect(ideas[0]?.notification.urgency).toBe('fyi');
    expect(ideas[0]?.notification.score).toBe(45);
    expect(ideas[0]?.notification.proposed_action).toEqual({
      kind: 'create_automation',
      instruction: 'every Friday, compile the weekly lead list and post it to sales',
    });
    expect(ideas[0]?.notification.evidence.run_ids).toHaveLength(3);
  });

  it('never counts the platform’s own runs', async () => {
    await seed_the_habit('system:automation_run');

    const result = await run_the_miner();

    expect(result.result_data).toMatchObject({ ran: false, code: 'no_candidates' });
    expect(generate_object).not.toHaveBeenCalled();
    expect(await list_ideas()).toEqual([]);
  });

  it('says nothing about an ask an enabled automation already covers', async () => {
    await seed_the_habit();
    await create_automation(db, {
      workspace_id,
      agent_id,
      automation_name: 'CEO list',
      instruction: 'Every Friday, pull the weekly lead list and post it to sales.',
      actor_id: 'usr_person',
    });

    const result = await run_the_miner();

    expect(result.result_data).toMatchObject({ ran: false, code: 'no_new_candidates' });
    expect(generate_object).not.toHaveBeenCalled();
  });

  it('never pitches an idea the person dismissed', async () => {
    await seed_the_habit();
    const fingerprint = notification_fingerprint(workspace_id, {
      subject: mined_ask_subject(normalize_ask(the_ask)),
      claim: recurring_ask_claim,
    });
    const dismissed = await record_notification_outcome(db, {
      workspace_id,
      subject: mined_ask_subject(normalize_ask(the_ask)),
      fingerprint,
      outcome: 'add_to_ideas_list',
      actor_id: 'system:test',
      notification: {
        agent_id,
        automation_id: null,
        run_id: 'run_old_miner',
        session_id: null,
        principal_id: null,
        title: 'You asked for this 3 times in 3 weeks',
        body: 'An idea they said no to.',
        urgency: 'fyi',
        score: 45,
        outcome_reason: 'an idea waits on the Ideas page',
        policy_hash: 'default',
        evidence: { event_ids: [], brain_slugs: [], run_ids: ['run_old'], message_refs: [] },
        proposed_action: { kind: 'none' },
        delivered_on: null,
        delivery_ref: null,
        delivery_error: null,
        expires_time: null,
        metadata: {},
      },
    });
    if (!dismissed) throw new Error('the old idea was not seeded');
    await append_notification_follow_up(db, {
      workspace_id,
      fingerprint,
      subject: mined_ask_subject(normalize_ask(the_ask)),
      follow_up: 'dismissed',
      outcome_event_id: dismissed.event_id,
      actor_id: 'system:test',
    });

    const result = await run_the_miner();

    expect(result.result_data).toMatchObject({ ran: false, code: 'no_new_candidates' });
    expect(generate_object).not.toHaveBeenCalled();
    expect(await list_ideas()).toHaveLength(1);
  });
});

describe('a habit belongs to the person who asked', () => {
  const [first_friday = '', second_friday = '', third_friday = ''] = three_fridays;

  it('never adds the asks of two people up into one habit', async () => {
    await seed_ask(db, { ask_text: the_ask, day: first_friday, created_by: 'user_ana' });
    await seed_ask(db, { ask_text: the_ask, day: second_friday, created_by: 'user_ana' });
    await seed_ask(db, { ask_text: the_ask, day: third_friday, created_by: 'user_ben' });

    const result = await run_the_miner();

    expect(result.result_data).toMatchObject({ ran: false, code: 'no_candidates' });
    expect(generate_object).not.toHaveBeenCalled();
    expect(await list_ideas()).toEqual([]);
  });

  it('addresses the idea to the person who asked, and counts only their asks', async () => {
    await seed_the_habit('user_ana');
    await seed_ask(db, { ask_text: the_ask, day: '2026-08-28', created_by: 'user_ben' });

    await run_the_miner();
    const [idea] = await list_ideas();

    expect(idea?.notification.principal_id).toBe('user_ana');
    expect(idea?.notification.title).toBe('You asked for this 3 times in 3 weeks');
    expect(idea?.notification.evidence.run_ids).toHaveLength(3);
  });

  it('shows the idea, with the words that person typed, to that person and to nobody else', async () => {
    await seed_the_habit('user_ana');

    await run_the_miner();
    const ideas = await list_ideas();
    const read_by = (user_id: string) =>
      keep_notifications_person_reads(db, { workspace_id, user_id }, ideas);

    expect(ideas[0]?.notification.body).toContain(the_ask);
    expect(await read_by('user_ana')).toHaveLength(1);
    expect(await read_by('user_ben')).toEqual([]);
  });
});
