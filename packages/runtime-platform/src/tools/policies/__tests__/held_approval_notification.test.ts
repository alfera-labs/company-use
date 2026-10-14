import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import { list_notifications_page } from '@coworker/core/db/queries/notification_outcomes';
import { set_policy } from '@coworker/core/db/queries/policies';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deliver_to_person } = vi.hoisted(() => ({
  deliver_to_person: vi.fn(async () => ({
    delivered_on: 'slack_dm' as const,
    delivery_ref: 'D1:1',
    delivery_error: null,
  })),
}));
vi.mock('@runtime-platform/delivery/deliver_to_person', async (import_original) => ({
  ...(await import_original<typeof import('@runtime-platform/delivery/deliver_to_person')>()),
  deliver_to_person,
}));
vi.mock('@runtime-platform/tools/policies/approval_delivery', () => ({
  send_approval_cards: vi.fn(async () => ({ sent: [] })),
}));

const { create_tool_batch_policy } = await import(
  '@runtime-platform/tools/policies/tool_batch_policy'
);

type Db = Awaited<ReturnType<typeof create_test_database>>;
let db: Db;
let fixture: {
  workspace_id: string;
  agent_id: string;
  user_id: string;
  session_id: string;
  run_id: string;
};

beforeEach(async () => {
  deliver_to_person.mockClear();
  db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  await set_policy(db, {
    workspace_id: bootstrap.workspace_id,
    resource_type: 'node',
    resource_id: 'math-calculate-1',
    scope_type: 'workspace',
    scope_id: bootstrap.workspace_id,
    policy_mode: 'ask',
    actor_id: bootstrap.user_id,
  });
  fixture = {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    user_id: bootstrap.user_id,
    session_id: session.session_id,
    run_id: run.run_id,
  };
});

async function hold_one_step() {
  const policy = create_tool_batch_policy(db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: fixture.run_id,
    agent_id: fixture.agent_id,
    actor_id: fixture.user_id,
  });
  return policy.decide([
    { tool_call_id: 'call_1', tool_name: 'math-calculate-1', input: { expression: '2 + 2' } },
  ]);
}

describe('a step held for a person', () => {
  it('mirrors the hold as a deadline notification carrying the wait expiry', async () => {
    const decision = await hold_one_step();
    expect(decision.kind).toBe('needs_approval');

    const [wait] = await list_tool_policy_waits(db, { workspace_id: fixture.workspace_id });
    const [notification] = await read_notifications();

    expect(notification?.notification).toMatchObject({
      urgency: 'deadline',
      run_id: fixture.run_id,
      session_id: fixture.session_id,
      score: 80,
      proposed_action: { kind: 'approve_held_call', job_id: wait?.job_id },
    });
    expect(notification?.notification.title).toBe('Waiting for your yes on math-calculate-1');
    expect(['notify_now', 'add_to_daily_summary']).toContain(notification?.outcome);
    expect(notification?.notification.expires_time).toBe(wait?.awaits_until_time?.toISOString());
  });

  it('asks once and mirrors once, however many times the model retries the step', async () => {
    await hold_one_step();
    await hold_one_step();

    expect(await read_notifications()).toHaveLength(1);
  });
});

async function read_notifications() {
  const page = await list_notifications_page(db, {
    workspace_id: fixture.workspace_id,
    page: 1,
    page_size: 100,
  });
  return page.items;
}
