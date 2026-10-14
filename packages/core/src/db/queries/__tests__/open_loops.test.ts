import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_tool_policy_wait } from '@coworker/core/db/queries/event_waits';
import { record_notification_outcome } from '@coworker/core/db/queries/notification_outcomes';
import { list_open_loops } from '@coworker/core/db/queries/open_loops';
import { run_messages, runs, triggers } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

const now = new Date('2026-09-15T12:00:00.000Z');

describe('list_open_loops', () => {
  it('returns every kind of open loop and nothing that is finished', async () => {
    const fixture = await create_fixture();
    await seed_failed_automation(fixture);
    await seed_healthy_automation(fixture);
    await seed_waiting_approval(fixture);
    await seed_open_notification(fixture);
    await seed_notification_with_no_proposal(fixture);
    await seed_unanswered_question(fixture);
    await seed_answered_conversation(fixture);

    const loops = await list_open_loops(fixture.db, { workspace_id: fixture.workspace_id, now });

    expect(loops.map((loop) => loop.kind).sort()).toEqual([
      'approval_waiting',
      'automation_stalled',
      'notification_open',
      'question_unanswered',
    ]);
    expect(loops.find((loop) => loop.kind === 'automation_stalled')?.title).toContain(
      'Late payments',
    );
    expect(loops.find((loop) => loop.kind === 'notification_open')?.title).toBe(
      'Sam changed the plan',
    );
    expect(loops.find((loop) => loop.kind === 'question_unanswered')?.detail).toContain(
      'Do you want me to send it?',
    );
  });

  it('calls an enabled automation past its next run time stalled', async () => {
    const fixture = await create_fixture();
    const automation = await create_automation(fixture.db, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      automation_name: 'Morning daily summary',
      instruction: 'Summarize the inbox.',
      actor_id: fixture.actor_id,
    });
    await fixture.db.insert(triggers).values({
      trigger_id: 'trg_morning',
      workspace_id: fixture.workspace_id,
      agent_id: fixture.agent_id,
      automation_id: automation.automation_id,
      trigger_name: 'Every morning',
      trigger_type: 'schedule',
      schedule_expression: '0 8 * * *',
      trigger_config: { starts_job_handler: 'run_automation' },
      next_run_time: new Date(now.getTime() - 60 * 60 * 1_000),
      created_by: fixture.actor_id,
      last_updated_by: fixture.actor_id,
    });

    const loops = await list_open_loops(fixture.db, { workspace_id: fixture.workspace_id, now });

    expect(loops).toHaveLength(1);
    expect(loops[0]?.kind).toBe('automation_stalled');
    expect(loops[0]?.title).toContain('past due');
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

async function seed_failed_automation(fixture: Fixture) {
  const automation = await create_automation(fixture.db, {
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    automation_name: 'Late payments',
    instruction: 'Chase every invoice older than 30 days.',
    actor_id: fixture.actor_id,
  });
  await seed_run(fixture, {
    run_id: 'run_failed',
    automation_id: automation.automation_id,
    run_status: 'failed',
    created_time: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
  });
  return automation;
}

async function seed_healthy_automation(fixture: Fixture) {
  const automation = await create_automation(fixture.db, {
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    automation_name: 'Weekly recap',
    instruction: 'Write the Friday recap.',
    actor_id: fixture.actor_id,
  });
  await seed_run(fixture, {
    run_id: 'run_ok',
    automation_id: automation.automation_id,
    run_status: 'completed',
    created_time: new Date(now.getTime() - 60 * 60 * 1_000),
  });
}

async function seed_run(
  fixture: Fixture,
  input: { run_id: string; automation_id: string; run_status: string; created_time: Date },
) {
  await fixture.db.insert(runs).values({
    run_id: input.run_id,
    workspace_id: fixture.workspace_id,
    session_id: `ses_${input.run_id}`,
    agent_id: fixture.agent_id,
    automation_id: input.automation_id,
    run_status: input.run_status,
    created_time: input.created_time,
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
}

async function seed_waiting_approval(fixture: Fixture) {
  await create_tool_policy_wait(fixture.db, {
    workspace_id: fixture.workspace_id,
    queue_key: 'tool_policy:ses_1:call_1',
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: 'ses_1',
      source_run_id: 'run_1',
      calls: [{ tool_call_id: 'tc_1', input_sha256: 'sha_1' }],
      requested_by: fixture.actor_id,
      eligible_user_ids: [fixture.actor_id],
    },
    actor_id: fixture.actor_id,
  });
}

async function seed_open_notification(fixture: Fixture) {
  await seed_notification(fixture, 'sha:sam', {
    title: 'Sam changed the plan',
    proposed_action: { kind: 'open_draft', session_id: 'ses_draft' },
  });
}

async function seed_notification_with_no_proposal(fixture: Fixture) {
  await seed_notification(fixture, 'sha:quiet', { title: 'Nothing to do about this one' });
}

async function seed_notification(
  fixture: Fixture,
  fingerprint: string,
  overrides: Partial<Parameters<typeof record_notification_outcome>[1]['notification']>,
) {
  await record_notification_outcome(fixture.db, {
    workspace_id: fixture.workspace_id,
    subject: fingerprint,
    fingerprint,
    outcome: 'add_to_daily_summary',
    actor_id: fixture.actor_id,
    notification: {
      agent_id: fixture.agent_id,
      automation_id: null,
      run_id: 'run_notification',
      session_id: null,
      principal_id: null,
      title: 'A notification',
      body: 'What was seen.',
      urgency: 'routine',
      score: 80,
      outcome_reason: 'below the interrupt line',
      policy_hash: 'default',
      evidence: { event_ids: ['evt_1'], brain_slugs: [], run_ids: [], message_refs: [] },
      proposed_action: { kind: 'none' },
      delivered_on: null,
      delivery_ref: null,
      delivery_error: null,
      expires_time: null,
      metadata: {},
      ...overrides,
    },
  });
}

async function seed_unanswered_question(fixture: Fixture) {
  await seed_message(fixture, {
    session_id: 'ses_question',
    message_sequence: 1,
    message_role: 'user',
    content_text: 'Can you draft the invoice?',
  });
  await seed_message(fixture, {
    session_id: 'ses_question',
    message_sequence: 2,
    message_role: 'assistant',
    content_text: 'The draft is ready. Do you want me to send it?',
  });
}

async function seed_answered_conversation(fixture: Fixture) {
  await seed_message(fixture, {
    session_id: 'ses_answered',
    message_sequence: 1,
    message_role: 'assistant',
    content_text: 'Should I send it?',
  });
  await seed_message(fixture, {
    session_id: 'ses_answered',
    message_sequence: 2,
    message_role: 'user',
    content_text: 'Yes please.',
  });
}

async function seed_message(
  fixture: Fixture,
  input: {
    session_id: string;
    message_sequence: number;
    message_role: string;
    content_text: string;
  },
) {
  await fixture.db.insert(run_messages).values({
    run_message_id: `msg_${input.session_id}_${input.message_sequence}`,
    workspace_id: fixture.workspace_id,
    session_id: input.session_id,
    run_id: `run_${input.session_id}`,
    message_role: input.message_role,
    message_kind: 'message',
    message_content: { type: 'text', text: input.content_text },
    content_text: input.content_text,
    message_sequence: input.message_sequence,
    run_message_sequence: input.message_sequence,
    created_time: new Date(now.getTime() - 60 * 60 * 1_000),
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
}
