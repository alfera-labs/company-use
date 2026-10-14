import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  append_notification_follow_up,
  count_notifications_sent_today,
  list_notifications_by_run_ids,
  list_open_notifications,
  type RecordNotificationOutcomeInput,
  record_notification_outcome,
  search_notifications,
} from '@coworker/core/db/queries/notification_outcomes';
import { events } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('the notification ledger', () => {
  it('refuses a second outcome with the same fingerprint, forever', async () => {
    const fixture = await create_fixture();

    const first = await write_notification(fixture, { fingerprint: 'sha:sofia-june-14' });
    const duplicate = await write_notification(fixture, { fingerprint: 'sha:sofia-june-14' });
    await append_notification_follow_up(fixture.db, {
      workspace_id: fixture.workspace_id,
      fingerprint: 'sha:sofia-june-14',
      subject: 'sofia',
      follow_up: 'acted',
      outcome_event_id: first?.event_id ?? '',
      actor_id: fixture.actor_id,
    });
    const after_the_answer = await write_notification(fixture, {
      fingerprint: 'sha:sofia-june-14',
    });
    const with_a_new_claim = await write_notification(fixture, {
      fingerprint: 'sha:sofia-june-21',
    });

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(after_the_answer).toBeNull();
    expect(with_a_new_claim).not.toBeNull();
  });

  it('takes a notification off the open list when a follow-up names it', async () => {
    const fixture = await create_fixture();
    const open = await write_notification(fixture, {
      fingerprint: 'sha:e',
      outcome: 'add_to_daily_summary',
    });
    await write_notification(fixture, { fingerprint: 'sha:f', outcome: 'notify_now' });

    const to_summarize = await list_open_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      outcomes: ['add_to_daily_summary'],
    });
    const follow_up = await append_notification_follow_up(fixture.db, {
      workspace_id: fixture.workspace_id,
      fingerprint: 'sha:e',
      subject: 'sofia',
      follow_up: 'summarized',
      outcome_event_id: open?.event_id ?? '',
      actor_id: fixture.actor_id,
    });
    const still_open = await list_open_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
    });

    expect(to_summarize).toHaveLength(1);
    expect(follow_up).not.toBeNull();
    expect(still_open.map((row) => row.fingerprint)).toEqual(['sha:f']);
  });

  it('refuses the same ending twice', async () => {
    const fixture = await create_fixture();
    const open = await write_notification(fixture, { fingerprint: 'sha:once' });
    const ending = { outcome_event_id: open?.event_id ?? '', follow_up: 'dismissed' as const };

    const first = await append_notification_follow_up(fixture.db, {
      workspace_id: fixture.workspace_id,
      fingerprint: 'sha:once',
      subject: 'sofia',
      actor_id: fixture.actor_id,
      ...ending,
    });
    const again = await append_notification_follow_up(fixture.db, {
      workspace_id: fixture.workspace_id,
      fingerprint: 'sha:once',
      subject: 'sofia',
      actor_id: fixture.actor_id,
      ...ending,
    });

    expect(first).not.toBeNull();
    expect(again).toBeNull();
  });

  it('counts only today, only the ones sent, only that person', async () => {
    const fixture = await create_fixture();

    await write_notification(fixture, { fingerprint: 'sha:a', principal_id: 'user_carla' });
    const backdated = await write_notification(fixture, {
      fingerprint: 'sha:b',
      principal_id: 'user_carla',
    });
    await backdate(fixture, backdated?.event_id ?? '');
    await write_notification(fixture, {
      fingerprint: 'sha:c',
      principal_id: 'user_carla',
      outcome: 'drop_with_reason',
    });
    await write_notification(fixture, {
      fingerprint: 'sha:failed',
      principal_id: 'user_carla',
      delivery_error: 'slack said no',
    });
    await write_notification(fixture, { fingerprint: 'sha:d', principal_id: 'user_sofia' });

    const for_carla = await count_notifications_sent_today(fixture.db, {
      workspace_id: fixture.workspace_id,
      principal_id: 'user_carla',
      timezone: 'UTC',
    });
    const for_the_workspace = await count_notifications_sent_today(fixture.db, {
      workspace_id: fixture.workspace_id,
      principal_id: null,
      timezone: 'UTC',
    });

    expect(for_carla).toBe(1);
    expect(for_the_workspace).toBe(2);
  });

  it('finds dropped notifications, by their evidence too, inside the window', async () => {
    const fixture = await create_fixture();
    await write_notification(fixture, {
      fingerprint: 'sha:g',
      outcome: 'drop_with_reason',
      title: 'Newsletter from the venue',
      evidence: {
        event_ids: ['event_harbor_99'],
        brain_slugs: [],
        run_ids: [],
        message_refs: [],
      },
    });
    const old_one = await write_notification(fixture, {
      fingerprint: 'sha:h',
      title: 'Harbor asked about June',
    });
    await backdate(fixture, old_one?.event_id ?? '', 10);

    const by_evidence = await search_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      search_text: 'harbor_99',
      days: 7,
    });
    const outside_window = await search_notifications(fixture.db, {
      workspace_id: fixture.workspace_id,
      search_text: 'asked about June',
      days: 7,
    });

    expect(by_evidence.map((row) => row.outcome)).toEqual(['drop_with_reason']);
    expect(outside_window).toHaveLength(0);
  });
});

describe('list_notifications_by_run_ids', () => {
  it('answers with the latest notification each run wrote, and whether it is still open', async () => {
    const fixture = await create_fixture();
    const run_id = create_id(id_prefixes.run);
    const other_run_id = create_id(id_prefixes.run);
    await write_notification(fixture, { fingerprint: 'sha:first', run_id, title: 'The first one' });
    const latest = await write_notification(fixture, {
      fingerprint: 'sha:latest',
      run_id,
      title: 'The later one',
      outcome: 'add_to_daily_summary',
    });
    const answered = await write_notification(fixture, {
      fingerprint: 'sha:other',
      run_id: other_run_id,
      title: 'Already answered',
    });
    await append_notification_follow_up(fixture.db, {
      workspace_id: fixture.workspace_id,
      fingerprint: 'sha:other',
      subject: 'sofia',
      follow_up: 'acted',
      outcome_event_id: answered?.event_id ?? '',
      actor_id: fixture.actor_id,
    });

    const told = await list_notifications_by_run_ids(fixture.db, {
      workspace_id: fixture.workspace_id,
      run_ids: [run_id, other_run_id],
    });
    const by_run = new Map(told.map((row) => [row.notification.run_id, row]));

    expect(told).toHaveLength(2);
    expect(by_run.get(run_id)?.event_id).toBe(latest?.event_id);
    expect(by_run.get(run_id)?.outcome).toBe('add_to_daily_summary');
    expect(by_run.get(run_id)?.is_open).toBe(true);
    expect(by_run.get(other_run_id)?.is_open).toBe(false);
  });

  it('asks nothing when no run is named', async () => {
    const fixture = await create_fixture();
    await write_notification(fixture, { fingerprint: 'sha:any' });

    expect(
      await list_notifications_by_run_ids(fixture.db, {
        workspace_id: fixture.workspace_id,
        run_ids: [],
      }),
    ).toEqual([]);
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return {
    db,
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

type NotificationOverrides = Partial<
  Pick<RecordNotificationOutcomeInput, 'fingerprint' | 'subject' | 'outcome'>
> &
  Partial<RecordNotificationOutcomeInput['notification']>;

async function write_notification(fixture: Fixture, overrides: NotificationOverrides) {
  const { fingerprint, subject, outcome, ...notification } = overrides;
  return record_notification_outcome(fixture.db, {
    workspace_id: fixture.workspace_id,
    subject: subject ?? 'sofia',
    fingerprint: fingerprint ?? 'sha:default',
    outcome: outcome ?? 'notify_now',
    actor_id: fixture.actor_id,
    notification: {
      agent_id: fixture.agent_id,
      automation_id: null,
      run_id: create_id(id_prefixes.run),
      session_id: null,
      principal_id: null,
      title: 'Ada moved the date to 14 June',
      body: 'She asked to move the wedding date; the quote is updated.',
      urgency: 'routine',
      score: 72,
      outcome_reason: 'a customer is waiting on an answer',
      policy_hash: 'default',
      evidence: { event_ids: ['event_1'], brain_slugs: [], run_ids: [], message_refs: [] },
      proposed_action: { kind: 'none' },
      delivered_on: null,
      delivery_ref: null,
      delivery_error: null,
      expires_time: null,
      metadata: {},
      ...notification,
    },
  });
}

async function backdate(fixture: Fixture, event_id: string, days = 1) {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await fixture.db.update(events).set({ created_time: when }).where(eq(events.event_id, event_id));
}

describe('reasons written before the words changed', () => {
  it('reads the old score sentences as the plain words the writer uses now', async () => {
    const { plain_outcome_reason } = await import(
      '@coworker/core/db/queries/notification_reason_words'
    );
    expect(plain_outcome_reason('score 5 is a drop in normal mode')).toBe(
      'not worth interrupting you',
    );
    expect(plain_outcome_reason('score 25 is an idea in normal mode')).toBe(
      'an idea, not something to do now',
    );
    expect(plain_outcome_reason('score 45 is a summary line in quiet mode')).toBe(
      'can wait for the summary',
    );
    expect(
      plain_outcome_reason('a system_problem notification clears the thresholds and quiet hours'),
    ).toBe("something on Alfera's side needs you");
    expect(
      plain_outcome_reason('it asks for a decision, which reaches you on When it matters'),
    ).toBe('it asks for a decision, which reaches you on When it matters');
  });
});
