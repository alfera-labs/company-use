import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  append_notification_follow_up,
  list_notifications_page,
  type RecordNotificationOutcomeInput,
  record_notification_outcome,
} from '@coworker/core/db/queries/notification_outcomes';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { events } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deliver_to_person = vi.fn(
  async (
    _db: unknown,
    _request: {
      principal_id: string | null;
      delivery_channel_order: readonly string[];
      message: { title: string; body: string };
    },
  ) => ({ delivered_on: 'slack_dm' as const, delivery_ref: 'D1:1', delivery_error: null }),
);
vi.mock('@runtime-platform/delivery/deliver_to_person', () => ({ deliver_to_person }));

const policy_timezone = { value: 'UTC' };
const policy_overrides: { value: Record<string, unknown> } = { value: {} };
vi.mock('@runtime-platform/notifications/notification_rules_file', async (import_original) => {
  const original =
    await import_original<
      typeof import('@runtime-platform/notifications/notification_rules_file')
    >();
  return {
    ...original,
    read_notification_rules_file: async () => ({
      policy: original.notification_rules_schema.parse({
        quiet_hours: { start: '19:00', end: '08:00', timezone: policy_timezone.value },
        ...policy_overrides.value,
      }),
      policy_hash: 'test',
      file_text: null,
      parse_failed: false,
    }),
  };
});

const { run_daily_summary_job } = await import('@runtime-platform/events/daily_summary_job');

type Db = Awaited<ReturnType<typeof create_test_database>>;

const daily_summary_o_clock = new Date('2026-09-15T08:35:00Z');

let db: Db;
let workspace_id: string;
let agent_id: string;
let fired_event: typeof events.$inferSelect;

beforeEach(async () => {
  deliver_to_person.mockClear();
  policy_timezone.value = 'UTC';
  policy_overrides.value = {};
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  workspace_id = bootstrap.workspace_id;
  agent_id = bootstrap.agent_id;

  const trigger = await create_trigger(db, {
    workspace_id,
    agent_id,
    trigger_name: 'Daily summary',
    trigger_type: 'schedule',
    schedule_expression: '3,18,33,48 * * * *',
    trigger_config: {
      starts_job_handler: 'run_daily_summary',
      provisioning_key: 'daily_summary_v1',
    },
    trigger_source: { kind: 'system', source: 'test', purpose: 'daily_summary' },
    actor_id: bootstrap.user_id,
  });
  const [row] = await db
    .insert(events)
    .values({
      event_id: 'evt_daily_summary_fire',
      workspace_id,
      source: 'trigger',
      source_event_id: `${trigger.trigger_id}:2026-09-15T08:33`,
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

type SeedOverrides = Partial<
  Pick<RecordNotificationOutcomeInput, 'fingerprint' | 'outcome'> &
    RecordNotificationOutcomeInput['notification']
> & { title: string };

async function seed_decision(db_handle: Database, overrides: SeedOverrides) {
  const { fingerprint, outcome, ...notification } = overrides;
  const written = await record_notification_outcome(db_handle, {
    workspace_id,
    subject: overrides.title,
    fingerprint: fingerprint ?? `fp_${overrides.title}`,
    outcome: outcome ?? 'add_to_daily_summary',
    actor_id: 'system:test',
    notification: {
      agent_id,
      automation_id: null,
      run_id: 'run_seed',
      session_id: null,
      principal_id: null,
      body: 'The body of the thing.',
      urgency: 'routine',
      score: 50,
      outcome_reason: 'score 50 is a summary line in normal mode',
      policy_hash: 'default',
      evidence: { event_ids: ['evt_1'], brain_slugs: [], run_ids: [], message_refs: [] },
      proposed_action: { kind: 'none' },
      delivered_on: null,
      delivery_ref: null,
      delivery_error: null,
      expires_time: null,
      metadata: { score_reason: 'the vendor never answered' },
      ...notification,
    },
  });
  if (!written) throw new Error('the notification was not seeded');
  return written;
}

function run_the_job(now: Date) {
  return run_daily_summary_job({ db, workspace_id, events: [fired_event], now });
}

describe('run_daily_summary_job', () => {
  it('opens the window at the daily_summary hour in the file’s timezone', async () => {
    policy_timezone.value = 'Europe/London';
    await seed_decision(db, { title: 'The vendor has not replied' });

    const too_late = await run_the_job(daily_summary_o_clock);
    const in_london = await run_the_job(new Date('2026-09-15T07:35:00Z'));

    expect(too_late.result_data).toMatchObject({
      ran: false,
      code: 'outside_daily_summary_window',
    });
    expect(in_london.result_data).toMatchObject({ ran: true, summarized: 1 });
  });

  it('composes only the open summary rows, and closes exactly those', async () => {
    const waiting = await seed_decision(db, { title: 'The vendor has not replied' });
    const also_waiting = await seed_decision(db, { title: 'Two invoices are unpaid' });
    const notified = await seed_decision(db, {
      title: 'Sam asked about invoice 1042',
      outcome: 'notify_now',
      fingerprint: 'fp_notify_now',
    });
    const already_sent = await seed_decision(db, {
      title: 'Last week, already said',
      fingerprint: 'fp_old',
    });
    await append_notification_follow_up(db, {
      workspace_id,
      fingerprint: 'fp_old',
      subject: 'Last week, already said',
      follow_up: 'summarized',
      outcome_event_id: already_sent.event_id,
      actor_id: 'system:test',
    });
    await db
      .update(events)
      .set({ created_time: new Date('2026-09-01T08:31:00Z') })
      .where(eq(events.source_event_id, 'fp_old:summarized'));

    const result = await run_the_job(daily_summary_o_clock);

    expect(result.result_data).toMatchObject({ ran: true, summarized: 2 });
    const message = deliver_to_person.mock.calls[0]?.[1]?.message;
    if (!message) throw new Error('no daily_summary was delivered');
    expect(message.title).toBe('Your daily summary: 2 things that waited');
    expect(message.body).toContain('The vendor has not replied');
    expect(message.body).toContain('Because: the vendor never answered');
    expect(message.body).toContain('Next: Nothing is needed from you.');
    expect(message.body).toContain('Two invoices are unpaid');
    expect(message.body).not.toContain('Sam asked about invoice 1042');
    expect(message.body).not.toContain('Last week, already said');

    const still_open = await read_open_state([
      waiting.event_id,
      also_waiting.event_id,
      notified.event_id,
    ]);
    expect(still_open).toEqual([false, false, true]);
  });

  it('sends one edition per person, so nobody reads somebody else news', async () => {
    const bootstrap_user = await db.query.users.findFirst();
    if (!bootstrap_user) throw new Error('no user was bootstrapped');
    await seed_decision(db, { title: 'For everybody' });
    await seed_decision(db, {
      title: 'For one person',
      fingerprint: 'fp_person',
      principal_id: bootstrap_user.user_id,
    });

    const result = await run_the_job(daily_summary_o_clock);

    expect(result.result_data).toMatchObject({ summarized: 2 });
    expect(deliver_to_person).toHaveBeenCalledTimes(2);
    const principals = deliver_to_person.mock.calls.map((call) => call[1].principal_id);
    expect(principals.sort()).toEqual([bootstrap_user.user_id, null].sort());
  });

  it('skips the weekend on a weekdays cadence, and sends on the channel the file names', async () => {
    policy_overrides.value = { daily_summary_cadence: 'weekdays', daily_summary_channel: 'email' };
    await seed_decision(db, { title: 'The vendor has not replied' });

    const saturday = await run_the_job(new Date('2026-09-19T08:35:00Z'));
    expect(saturday.result_data).toMatchObject({ code: 'outside_daily_summary_window' });
    expect(deliver_to_person).not.toHaveBeenCalled();

    await run_the_job(daily_summary_o_clock);
    expect(deliver_to_person.mock.calls[0]?.[1].delivery_channel_order).toEqual(['email', 'web']);
  });

  it('says nothing at 14:00, and nothing twice in the same morning', async () => {
    await seed_decision(db, { title: 'The vendor has not replied' });

    const wrong_hour = await run_the_job(new Date('2026-09-15T14:00:00Z'));
    expect(wrong_hour.result_data).toMatchObject({ code: 'outside_daily_summary_window' });
    expect(deliver_to_person).not.toHaveBeenCalled();

    await run_the_job(daily_summary_o_clock);
    await seed_decision(db, { title: 'A later thing', fingerprint: 'fp_later' });
    const second_try = await run_the_job(new Date('2026-09-15T08:44:00Z'));

    expect(second_try.result_data).toMatchObject({ code: 'daily_summary_already_sent' });
    expect(deliver_to_person).toHaveBeenCalledTimes(1);
  });
});

async function read_open_state(event_ids: string[]) {
  const page = await list_notifications_page(db, { workspace_id, page: 1, page_size: 100 });
  return event_ids.map((id) => page.items.find((row) => row.event_id === id)?.is_open ?? 'missing');
}
