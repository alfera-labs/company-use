import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { record_notification_outcome } from '@coworker/core/db/queries/notification_outcomes';
import { describe, expect, it } from 'vitest';

async function create_fixture() {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  return { db, identity, app: create_app(db) };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

type NotificationOverrides = Partial<
  Pick<Parameters<typeof record_notification_outcome>[1], 'outcome'> &
    Parameters<typeof record_notification_outcome>[1]['notification']
>;

async function write_decision(fixture: Fixture, overrides: NotificationOverrides = {}) {
  const { outcome, ...notification } = overrides;
  return record_notification_outcome(fixture.db, {
    workspace_id: fixture.identity.workspace_id,
    subject: notification.title ?? 'Ada asked about June 14',
    fingerprint: `fingerprint_${Math.random()}`,
    outcome: outcome ?? 'notify_now',
    actor_id: 'test',
    notification: {
      agent_id: fixture.identity.agent_id,
      automation_id: null,
      run_id: 'run_test',
      session_id: null,
      principal_id: null,
      title: 'Ada asked about June 14',
      body: 'The client moved their date and wants a new quote.',
      urgency: 'routine',
      score: 70,
      outcome_reason: 'Above the normal threshold.',
      policy_hash: 'default',
      evidence: { event_ids: ['evt_1'], brain_slugs: [], run_ids: [], message_refs: [] },
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

describe('GET /v1/notifications', () => {
  it('lists what was said and what was thrown away, with the reason on the row', async () => {
    const fixture = await create_fixture();
    await write_decision(fixture);
    await write_decision(fixture, {
      title: 'A newsletter arrived',
      outcome: 'drop_with_reason',
      outcome_reason: 'Nobody needs to know a newsletter arrived.',
      score: 4,
    });

    const listed = (await (await fixture.app.request('/v1/notifications')).json()).data;

    expect(listed.total_count).toBe(2);
    expect(listed.items.map((item: { outcome: string }) => item.outcome).sort()).toEqual([
      'drop_with_reason',
      'notify_now',
    ]);
    const dropped = listed.items.find(
      (item: { outcome: string }) => item.outcome === 'drop_with_reason',
    );
    expect(dropped.notification.outcome_reason).toBe('Nobody needs to know a newsletter arrived.');
    expect(dropped.notification.policy_hash).toBe('default');
  });

  it('filters by outcome and by a word in the notification', async () => {
    const fixture = await create_fixture();
    await write_decision(fixture);
    await write_decision(fixture, {
      title: 'A newsletter arrived',
      outcome: 'drop_with_reason',
    });

    const by_outcome = (
      await (await fixture.app.request('/v1/notifications?outcome=drop_with_reason')).json()
    ).data;
    const by_word = (await (await fixture.app.request('/v1/notifications?q=Ada')).json()).data;

    expect(by_outcome.items).toHaveLength(1);
    expect(by_outcome.items[0].notification.title).toBe('A newsletter arrived');
    expect(by_word.items).toHaveLength(1);
    expect(by_word.items[0].notification.title).toBe('Ada asked about June 14');
  });

  it('refuses a filter value that is not an outcome instead of ignoring it', async () => {
    const fixture = await create_fixture();

    const response = await fixture.app.request('/v1/notifications?outcome=whatever');

    expect(response.status).toBe(422);
  });
});

describe('POST /v1/notifications/:id/dismiss and /act', () => {
  it.each([
    ['dismiss', 'dismissed'],
    ['act', 'acted'],
  ])('%s closes the notification with a follow-up event', async (action, follow_up) => {
    const fixture = await create_fixture();
    const written = await write_decision(fixture);

    const response = await fixture.app.request(`/v1/notifications/${written?.event_id}/${action}`, {
      method: 'POST',
    });
    const ended = (await response.json()).data;

    expect(response.status).toBe(200);
    expect(ended.is_open).toBe(false);
    const still_open = (await (await fixture.app.request('/v1/notifications?open=true')).json())
      .data;
    expect(still_open.total_count).toBe(0);
    const all = (await (await fixture.app.request('/v1/notifications')).json()).data;
    expect(all.total_count).toBe(1);
    expect(follow_up).toMatch(/^(dismissed|acted)$/u);
  });

  it('answers 404 for a notification this workspace does not have', async () => {
    const fixture = await create_fixture();

    const response = await fixture.app.request('/v1/notifications/atd_nothing/dismiss', {
      method: 'POST',
    });

    expect(response.status).toBe(404);
  });
});
