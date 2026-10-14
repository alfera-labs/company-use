import { beforeEach, describe, expect, it, vi } from 'vitest';

const cron_schedule = {
  supports_run_once: true,
  set_schedule: vi.fn(async () => {}),
  pause_schedule: vi.fn(async () => {}),
  delete_schedule: vi.fn(async () => {}),
};

vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => cron_schedule,
}));

const { create_agent_scheduled_task, set_workspace_trigger_status, update_agent_scheduled_task } =
  await import('@api/services/triggers');
const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
const { workspaces } = await import('@coworker/core/db/schema');
const { eq } = await import('drizzle-orm');

async function create_wall_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await db
    .update(workspaces)
    .set({ created_time: new Date('2026-09-10T00:00:00Z') })
    .where(eq(workspaces.workspace_id, bootstrap.workspace_id));
  return { db, bootstrap };
}

function recurring_task_input(bootstrap: {
  workspace_id: string;
  agent_id: string;
  user_id: string;
}) {
  return {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    task_name: 'Monday digest',
    instruction: 'Every Monday, draft the digest.',
    schedule_expression: '0 9 * * 1',
    timezone: 'UTC',
    actor_id: bootstrap.user_id,
  };
}

describe('standing work with no card on file', () => {
  beforeEach(() => {
    cron_schedule.set_schedule.mockClear();
    cron_schedule.pause_schedule.mockClear();
  });

  it('creates a recurring task enabled and provisions its cron', async () => {
    const { db, bootstrap } = await create_wall_fixture();

    const trigger = await create_agent_scheduled_task(db, recurring_task_input(bootstrap));

    expect(trigger.trigger_status).toBe('enabled');
    expect(cron_schedule.set_schedule).toHaveBeenCalledOnce();
  });

  it('lets a one-time task through', async () => {
    const { db, bootstrap } = await create_wall_fixture();

    const run_once_at = new Date(Date.now() + 3_600_000).toISOString();
    const trigger = await create_agent_scheduled_task(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      task_name: 'Tomorrow, once',
      instruction: 'Send the reminder.',
      run_once_at,
      timezone: 'UTC',
      actor_id: bootstrap.user_id,
    });

    expect(trigger.trigger_status).toBe('enabled');
  });

  it('turns a paused task back on from either door', async () => {
    const { db, bootstrap } = await create_wall_fixture();
    const trigger = await create_agent_scheduled_task(db, recurring_task_input(bootstrap));
    const pause = { workspace_id: bootstrap.workspace_id, trigger_id: trigger.trigger_id };
    await set_workspace_trigger_status(db, {
      ...pause,
      trigger_status: 'disabled',
      actor_id: bootstrap.user_id,
    });

    const enabled = await set_workspace_trigger_status(db, {
      ...pause,
      trigger_status: 'enabled',
      actor_id: bootstrap.user_id,
    });
    expect(enabled.trigger_status).toBe('enabled');

    await set_workspace_trigger_status(db, {
      ...pause,
      trigger_status: 'disabled',
      actor_id: bootstrap.user_id,
    });
    const updated = await update_agent_scheduled_task(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_id: trigger.trigger_id,
      trigger_status: 'enabled',
      actor_id: bootstrap.user_id,
    });
    expect(updated.trigger_status).toBe('enabled');
  });
});
