import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { record_notification_outcome } from '@coworker/core/db/queries/notification_outcomes';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { event_jobs, events, runs } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

const audit = { created_by: 'test', last_updated_by: 'test' };

async function create_fixture() {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  await claim_card_unlock(db, identity.workspace_id);
  const app = create_app(db);
  const created = (
    await (
      await app.request('/v1/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automation_name: 'Answer billing questions',
          instruction: 'Read the message and draft a reply.',
          triggers: [{ kind: 'manual' }],
        }),
      })
    ).json()
  ).data;
  const [trigger] = await list_automation_triggers(db, {
    workspace_id: identity.workspace_id,
    automation_id: created.automation.automation_id,
  });
  return {
    db,
    identity,
    app,
    automation_id: created.automation.automation_id,
    trigger_id: trigger?.trigger_id ?? '',
  };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function write_fire(
  fixture: Fixture,
  input: {
    fired_time: Date;
    job_status?: string;
    result_data?: Record<string, unknown>;
    error_data?: Record<string, unknown>;
    run_id?: string;
    without_job?: boolean;
  },
) {
  const event_id = create_id(id_prefixes.event);
  await fixture.db.insert(events).values({
    event_id,
    workspace_id: fixture.identity.workspace_id,
    source: 'trigger',
    source_event_id: `occurrence_${event_id}`,
    event_type: 'trigger.fired',
    queue_key: `trigger:${fixture.trigger_id}`,
    actor_key: 'system:test',
    event_body: { trigger_id: fixture.trigger_id },
    created_time: input.fired_time,
    ...audit,
  });
  if (input.without_job) return event_id;
  await fixture.db.insert(event_jobs).values({
    job_id: create_id(id_prefixes.event_job),
    workspace_id: fixture.identity.workspace_id,
    event_id,
    queue_key: `trigger:${fixture.trigger_id}`,
    job_handler: 'run_automation',
    job_status: input.job_status ?? 'done',
    result_data: input.result_data ?? {},
    error_data: input.error_data ?? {},
    run_id: input.run_id ?? null,
    created_time: input.fired_time,
    ...audit,
  });
  return event_id;
}

async function list_fires(fixture: Fixture, automation_id = fixture.automation_id) {
  const response = await fixture.app.request(`/v1/automations/${automation_id}/fires`);
  return (await response.json()).data;
}

describe('GET /v1/automations/:automation_id/fires', () => {
  it('says why a fire was turned away, rule and judge alike', async () => {
    const fixture = await create_fixture();
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      result_data: { ran: false, skipped: { stage: 'rule', reason: 'The sender is a no-reply.' } },
    });
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T10:00:00Z'),
      result_data: {
        ran: false,
        skipped: { stage: 'judge', reason: '30 < 60: it reads like a newsletter' },
        judge: { confidence: 30, reason: 'it reads like a newsletter' },
      },
    });

    const page = await list_fires(fixture);

    expect(page.total_count).toBe(2);
    expect(page.items.map((item: { outcome: string }) => item.outcome)).toEqual([
      'skipped',
      'skipped',
    ]);
    expect(page.items[0].reason).toBe('judge 30: 30 < 60: it reads like a newsletter');
    expect(page.items[1].reason).toBe('rule: The sender is a no-reply.');
    expect(page.items[1]).toMatchObject({
      skipped: { stage: 'rule', reason: 'The sender is a no-reply.' },
      judge: null,
      budget_limit: null,
    });
    expect(page.items[0].skipped).toEqual({
      stage: 'judge',
      reason: 'it reads like a newsletter',
    });
  });

  it('carries the judge numbers and a budget pause as fields', async () => {
    const fixture = await create_fixture();
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      result_data: {
        ran: false,
        skipped: { stage: 'judge', reason: 'Likely, but not sure enough to run.' },
        judge: { answer: 'yes', confidence: 0.7, threshold: 0.8, reason: 'fits' },
      },
    });
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T10:00:00Z'),
      result_data: {
        ran: false,
        code: 'automation_over_budget',
        message: 'Automation Lead intake paused: it fired 51 times today, past its budget of 50',
        budget_limit: 50,
      },
    });

    const page = await list_fires(fixture);

    expect(page.items[0]).toMatchObject({ outcome: 'didnt_fire', budget_limit: 50 });
    expect(page.items[1]).toMatchObject({
      outcome: 'skipped',
      skipped: { stage: 'judge', reason: 'Likely, but not sure enough to run.' },
      judge: { confidence: 0.7, threshold: 0.8 },
    });
  });

  it('carries the run and the session of a fire that became work', async () => {
    const fixture = await create_fixture();
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      result_data: { ran: true, run_id: 'run_1', session_id: 'ses_1' },
    });

    const page = await list_fires(fixture);

    expect(page.items[0]).toMatchObject({
      outcome: 'fired',
      reason: null,
      run_id: 'run_1',
      session_id: 'ses_1',
      trigger_name: 'Answer billing questions',
    });
  });

  it('calls a queued job waiting and a failed one a fire that did not run', async () => {
    const fixture = await create_fixture();
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      job_status: 'queued',
    });
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T10:00:00Z'),
      job_status: 'failed',
      error_data: { message: 'Gmail said no.' },
    });

    const page = await list_fires(fixture);

    expect(page.items[0]).toMatchObject({ outcome: 'didnt_fire', reason: 'Gmail said no.' });
    expect(page.items[1]).toMatchObject({ outcome: 'waiting', reason: null });
  });

  it('calls a fire whose run is still going running, and carries the chat of that run', async () => {
    const fixture = await create_fixture();
    const write_run = async (run_status: string) => {
      const run = {
        run_id: create_id(id_prefixes.run),
        session_id: create_id(id_prefixes.session),
      };
      await fixture.db.insert(runs).values({
        ...run,
        workspace_id: fixture.identity.workspace_id,
        agent_id: fixture.identity.agent_id,
        automation_id: fixture.automation_id,
        run_status,
        ...audit,
      });
      return run;
    };
    const working = await write_run('running');
    const asking = await write_run('waiting');
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      job_status: 'running',
      run_id: working.run_id,
    });
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T10:00:00Z'),
      job_status: 'running',
      run_id: asking.run_id,
    });

    const page = await list_fires(fixture);

    expect(page.items[1]).toMatchObject({ outcome: 'running', ...working });
    expect(page.items[0]).toMatchObject({ outcome: 'waiting', ...asking });
  });

  it('shows a fire that never became a job rather than dropping it from the history', async () => {
    const fixture = await create_fixture();
    await write_fire(fixture, { fired_time: new Date('2026-09-10T09:00:00Z'), without_job: true });

    const page = await list_fires(fixture);

    expect(page.items[0]).toMatchObject({
      outcome: 'didnt_fire',
      reason: 'No automation job was queued for this.',
    });
  });

  it('never shows the fires of another automation', async () => {
    const fixture = await create_fixture();
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      result_data: { ran: true },
    });

    const page = await list_fires(fixture, 'atm_someone_else');

    expect(page.total_count).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('carries what the run told you, held offers included', async () => {
    const fixture = await create_fixture();
    const run_id = create_id(id_prefixes.run);
    const session_id = create_id(id_prefixes.session);
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      result_data: { ran: true, run_id, session_id },
    });
    await record_notification_outcome(fixture.db, {
      workspace_id: fixture.identity.workspace_id,
      subject: 'the refund note',
      fingerprint: 'sha:the-note',
      outcome: 'add_to_daily_summary',
      actor_id: 'system:test',
      notification: {
        agent_id: fixture.identity.agent_id,
        automation_id: fixture.automation_id,
        run_id,
        session_id,
        principal_id: null,
        title: 'Add the note about the refund to the brain?',
        body: 'Sam said the refund arrived on Friday.',
        urgency: 'routine',
        score: 80,
        outcome_reason: "today's 5 interruptions are spent",
        policy_hash: 'default',
        evidence: { event_ids: ['event_1'], brain_slugs: [], run_ids: [], message_refs: [] },
        proposed_action: { kind: 'offer_to_act', instruction: 'add the note', needs_apps: [] },
        delivered_on: null,
        delivery_ref: null,
        delivery_error: null,
        expires_time: null,
        metadata: {},
      },
    });

    const page = await list_fires(fixture);

    expect(page.items[0].told).toMatchObject({
      title: 'Add the note about the refund to the brain?',
      outcome: 'add_to_daily_summary',
      outcome_reason: "today's 5 interruptions are spent",
      asks_the_person: true,
      open: true,
    });
  });

  it('tells you plainly when a run told you nothing', async () => {
    const fixture = await create_fixture();
    await write_fire(fixture, {
      fired_time: new Date('2026-09-10T09:00:00Z'),
      result_data: { ran: true, run_id: create_id(id_prefixes.run) },
    });

    const page = await list_fires(fixture);

    expect(page.items[0]).toMatchObject({ outcome: 'fired', told: null });
  });
});
