import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_run_message, create_session } from '@coworker/core/db/queries/sessions';
import { events, run_messages, runs } from '@coworker/core/db/schema';
import { collect_scout_context } from '@runtime-platform/scout/scout_context';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-09-15T12:00:00.000Z');
const no_embedder = undefined;

describe('collect_scout_context', () => {
  it('carries the last three days of signals, the open loops, and nothing older', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const automation = await create_automation(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      automation_name: 'Late payments',
      instruction: 'Chase every invoice older than 30 days.',
      actor_id: bootstrap.user_id,
    });
    await db.insert(runs).values({
      run_id: 'run_failed',
      workspace_id: bootstrap.workspace_id,
      session_id: 'ses_1',
      agent_id: bootstrap.agent_id,
      automation_id: automation.automation_id,
      run_status: 'failed',
      created_time: new Date(now.getTime() - 60 * 60 * 1_000),
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    });
    await seed_event(db, bootstrap.workspace_id, {
      event_id: 'evt_fresh',
      source: 'gmail',
      raw_text: 'Sam asked to move the call to 14 June',
      created_time: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
    });
    await seed_event(db, bootstrap.workspace_id, {
      event_id: 'evt_stale',
      source: 'gmail',
      raw_text: 'Last month newsletter',
      created_time: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1_000),
    });
    await seed_event(db, bootstrap.workspace_id, {
      event_id: 'evt_our_own_clock',
      source: 'trigger',
      raw_text: 'trigger fired',
      created_time: new Date(now.getTime() - 60 * 1_000),
    });

    const context = await collect_scout_context(db, {
      workspace_id: bootstrap.workspace_id,
      now,
      embedder: no_embedder,
    });

    expect(context.recent_signals.map((signal) => signal.event_id)).toEqual(['evt_fresh']);
    expect(context.recent_signals[0]?.title).toBe('Sam asked to move the call to 14 June');
    expect(context.open_loops).toHaveLength(1);
    expect(context.open_loops[0]).toMatchObject({
      kind: 'automation_stalled',
      reference_id: automation.automation_id,
    });
    expect(Array.isArray(context.memory_hits)).toBe(true);
  });

  it('hears what a listen ear heard, under the name of the app it came from', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await db.insert(events).values({
      event_id: 'evt_listen',
      workspace_id: bootstrap.workspace_id,
      source: 'trigger',
      source_event_id: 'trg_listen:pi_1',
      event_type: 'trigger.fired',
      queue_key: 'trigger:trg_listen',
      actor_key: 'system:trigger',
      event_body: {
        trigger_id: 'trg_listen',
        delivery: {
          provider: 'composio',
          trigger_slug: 'STRIPE_PAYMENT_INTENT_PAYMENT_FAILED',
          received_time: '2026-09-15T11:00:00.000Z',
          data: { id: 'pi_1', summary: 'Acme card declined, 900 EUR' },
        },
      },
      created_time: new Date(now.getTime() - 60 * 60 * 1_000),
      created_by: 'system:trigger',
      last_updated_by: 'system:trigger',
    });

    const context = await collect_scout_context(db, {
      workspace_id: bootstrap.workspace_id,
      now,
      embedder: no_embedder,
    });

    expect(context.recent_signals).toEqual([
      {
        event_id: 'evt_listen',
        source: 'stripe',
        event_type: 'STRIPE_PAYMENT_INTENT_PAYMENT_FAILED',
        title: 'Acme card declined, 900 EUR',
        created_time: '2026-09-15T11:00:00.000Z',
        sender: 'system:trigger',
        subject_id: 'trigger:trg_listen',
        door: null,
      },
    ]);
  });

  it('carries what the last seven days of runs finished by saying, first line each', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await say_in_a_run(db, bootstrap, {
      run_id: 'run_quote',
      text: 'I will send the Acme invoice on Friday.\nHere is the draft I used.',
      created_time: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1_000),
    });
    await say_in_a_run(db, bootstrap, {
      run_id: 'run_old',
      text: 'Something I said last month.',
      created_time: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000),
    });

    const context = await collect_scout_context(db, {
      workspace_id: bootstrap.workspace_id,
      now,
      embedder: no_embedder,
    });

    expect(context.recent_deliverables).toHaveLength(1);
    expect(context.recent_deliverables[0]).toMatchObject({
      run_id: 'run_quote',
      first_line: 'I will send the Acme invoice on Friday.',
    });
  });
});

async function say_in_a_run(
  db: Awaited<ReturnType<typeof create_test_database>>,
  bootstrap: Awaited<ReturnType<typeof bootstrap_default_workspace>>,
  input: { run_id: string; text: string; created_time: Date },
) {
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    run_id: input.run_id,
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  const message = await create_run_message(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    message_role: 'assistant',
    message_content: { type: 'text', text: input.text },
    source_type: 'runtime',
    actor_id: bootstrap.user_id,
  });
  await db
    .update(run_messages)
    .set({ created_time: input.created_time })
    .where(eq(run_messages.run_message_id, message.run_message_id));
}

async function seed_event(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
  input: { event_id: string; source: string; raw_text: string; created_time: Date },
) {
  await db.insert(events).values({
    event_id: input.event_id,
    workspace_id,
    source: input.source,
    source_event_id: input.event_id,
    event_type: 'message',
    queue_key: `${input.source}:${input.event_id}`,
    actor_key: 'someone',
    event_body: { raw_text: input.raw_text },
    created_time: input.created_time,
    created_by: 'test',
    last_updated_by: 'test',
  });
}
