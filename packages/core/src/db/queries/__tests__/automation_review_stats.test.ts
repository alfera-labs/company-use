import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_automation_review_stats } from '@coworker/core/db/queries/automation_review_stats';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import {
  append_notification_follow_up,
  record_notification_outcome,
} from '@coworker/core/db/queries/notification_outcomes';
import { automations, event_jobs, events, runs, triggers } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

const now = new Date('2026-09-14T12:00:00.000Z');
const last_week = new Date(now.getTime() - 20 * 86_400_000);

describe('list_automation_review_stats', () => {
  it('counts a week of fires, notifications and answered approvals per automation', async () => {
    const fixture = await create_fixture();
    const busy = await seed_automation(fixture, 'Late payments');
    const silent = await seed_automation(fixture, 'Weekly recap');
    await seed_trigger(fixture, busy, 'trg_busy');
    await seed_fire(fixture, 'trg_busy', 'evt_1', { ran: true, session_id: 'ses_1' });
    await seed_fire(fixture, 'trg_busy', 'evt_2', { ran: true, session_id: 'ses_1' });
    await seed_fire(fixture, 'trg_busy', 'evt_3', {
      ran: false,
      skipped: { stage: 'judge', reason: 'it reads like a newsletter' },
      judge: { confidence: 0.9, reason: 'newsletter' },
    });
    await seed_notification(fixture, busy, 'sha:open', 'open');
    await seed_notification(fixture, busy, 'sha:dismissed', 'dismissed');
    await seed_answered_approval(fixture, busy, 'approved');
    await seed_answered_approval(fixture, busy, 'denied');

    const weeks = await list_automation_review_stats(fixture.db, {
      workspace_id: fixture.workspace_id,
      now,
    });

    const busy_week = weeks.find((week) => week.automation_id === busy);
    expect(busy_week).toMatchObject({
      automation_name: 'Late payments',
      fires: 3,
      ran: 2,
      skipped_by_stage: { judge: 1 },
      notifications: 2,
      notifications_by_end: { open: 1, acted: 0, dismissed: 1, expired: 0 },
      approvals_answered_yes: 1,
      approvals_answered_no: 1,
    });
    expect(weeks.find((week) => week.automation_id === silent)).toMatchObject({
      fires: 0,
      ran: 0,
      notifications: 0,
      approvals_answered_yes: 0,
    });
  });

  it('leaves out last month, and leaves out an automation nobody enabled', async () => {
    const fixture = await create_fixture();
    const automation = await seed_automation(fixture, 'Late payments');
    const paused = await seed_automation(fixture, 'Old one', 'paused');
    await seed_trigger(fixture, automation, 'trg_busy');
    await seed_fire(fixture, 'trg_busy', 'evt_old', { ran: true }, last_week);
    await seed_notification(fixture, automation, 'sha:old', 'acted', last_week);

    const weeks = await list_automation_review_stats(fixture.db, {
      workspace_id: fixture.workspace_id,
      now,
    });

    expect(weeks.map((week) => week.automation_id)).toEqual([automation]);
    expect(weeks[0]).toMatchObject({ fires: 0, notifications: 0 });
    expect(weeks.some((week) => week.automation_id === paused)).toBe(false);
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

async function seed_automation(fixture: Fixture, name: string, status?: 'paused') {
  const automation = await create_automation(fixture.db, {
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    automation_name: name,
    instruction: 'Do the thing.',
    actor_id: fixture.actor_id,
  });
  if (status) {
    await fixture.db
      .update(automations)
      .set({ automation_status: status })
      .where(
        and(
          eq(automations.workspace_id, fixture.workspace_id),
          eq(automations.automation_id, automation.automation_id),
        ),
      );
  }
  return automation.automation_id;
}

async function seed_trigger(fixture: Fixture, automation_id: string, trigger_id: string) {
  await fixture.db.insert(triggers).values({
    trigger_id,
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    automation_id,
    trigger_name: 'Every morning',
    trigger_type: 'schedule',
    schedule_expression: '0 8 * * *',
    trigger_config: { starts_job_handler: 'run_automation' },
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
}

async function seed_fire(
  fixture: Fixture,
  trigger_id: string,
  event_id: string,
  result_data: Record<string, unknown>,
  created_time: Date = now,
) {
  await fixture.db.insert(events).values({
    event_id,
    workspace_id: fixture.workspace_id,
    source: 'trigger',
    source_event_id: event_id,
    event_type: 'trigger.fired',
    queue_key: `trigger:${trigger_id}`,
    actor_key: 'system:triggers',
    event_body: { trigger_id },
    created_time,
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
  await fixture.db.insert(event_jobs).values({
    job_id: `job_${event_id}`,
    workspace_id: fixture.workspace_id,
    event_id,
    queue_key: `trigger:${trigger_id}`,
    job_handler: 'run_automation',
    job_status: 'done',
    result_data,
    created_time,
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
}

async function seed_notification(
  fixture: Fixture,
  automation_id: string,
  fingerprint: string,
  ending: 'open' | 'dismissed' | 'acted',
  created_time: Date = now,
) {
  const written = await record_notification_outcome(fixture.db, {
    workspace_id: fixture.workspace_id,
    subject: fingerprint,
    fingerprint,
    outcome: 'add_to_daily_summary',
    actor_id: fixture.actor_id,
    notification: {
      agent_id: fixture.agent_id,
      automation_id,
      run_id: 'run_notification',
      session_id: null,
      principal_id: null,
      title: 'A notification',
      body: 'What was seen.',
      urgency: 'routine',
      score: 40,
      outcome_reason: 'below the interrupt line',
      policy_hash: 'default',
      evidence: { event_ids: ['evt_1'], brain_slugs: [], run_ids: [], message_refs: [] },
      proposed_action: { kind: 'none' },
      delivered_on: null,
      delivery_ref: null,
      delivery_error: null,
      expires_time: null,
      metadata: {},
    },
  });
  if (ending !== 'open') {
    await append_notification_follow_up(fixture.db, {
      workspace_id: fixture.workspace_id,
      fingerprint,
      subject: fingerprint,
      follow_up: ending,
      outcome_event_id: written?.event_id ?? '',
      actor_id: fixture.actor_id,
    });
  }
  await fixture.db
    .update(events)
    .set({ created_time })
    .where(
      and(
        eq(events.workspace_id, fixture.workspace_id),
        eq(events.event_id, written?.event_id ?? ''),
      ),
    );
}

async function seed_answered_approval(
  fixture: Fixture,
  automation_id: string,
  decision: 'approved' | 'denied',
) {
  const run_id = `run_${decision}`;
  await fixture.db.insert(runs).values({
    run_id,
    workspace_id: fixture.workspace_id,
    session_id: `ses_${run_id}`,
    agent_id: fixture.agent_id,
    automation_id,
    run_status: 'completed',
    created_time: now,
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
  const wait = await create_tool_policy_wait(fixture.db, {
    workspace_id: fixture.workspace_id,
    queue_key: `tool_policy:${run_id}`,
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: `ses_${run_id}`,
      source_run_id: run_id,
      calls: [{ tool_call_id: `tc_${run_id}`, input_sha256: 'sha_1' }],
      requested_by: fixture.actor_id,
      eligible_user_ids: [fixture.actor_id],
    },
    actor_id: fixture.actor_id,
  });
  await fixture.db.insert(events).values({
    event_id: `evt_decided_${decision}`,
    workspace_id: fixture.workspace_id,
    source: 'policy',
    source_event_id: `${wait.event_job.job_id}:decided`,
    event_type: 'person.decided',
    queue_key: `tool_policy:${run_id}`,
    actor_key: fixture.actor_id,
    event_body: { job_id: wait.event_job.job_id, decision },
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
}
