import { create_workspace_automation } from '@api/services/automations/automation_service';
import { create_workspace_system_automation_triggers } from '@api/services/triggers/system_automation_schedules';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cron = vi.hoisted(() => ({
  set_schedule: vi.fn<(schedule: { trigger_id: string }) => Promise<void>>(),
}));

vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => ({
    supports_run_once: true,
    set_schedule: cron.set_schedule,
    pause_schedule: vi.fn(),
    delete_schedule: vi.fn(),
  }),
}));

describe('the workspace system automation schedules', () => {
  beforeEach(() => {
    cron.set_schedule.mockReset();
  });

  it('creates one tick per workspace, four times an hour on the workspace own minutes', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const created = await create_workspace_system_automation_triggers(db, {
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
    });

    expect(created.map((trigger) => trigger.trigger_config.starts_job_handler)).toEqual([
      'run_attention_tick',
    ]);
    expect(created.every((trigger) => trigger.trigger_source.kind === 'system')).toBe(true);
    const tick = created.find(
      (trigger) => trigger.trigger_config.starts_job_handler === 'run_attention_tick',
    );
    expect(tick?.schedule_expression?.split(' ')[0]?.split(',')).toHaveLength(4);
    expect(tick?.trigger_config.timezone).toBeTruthy();
    expect(cron.set_schedule).toHaveBeenCalledTimes(1);

    const again = await create_workspace_system_automation_triggers(db, {
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
    });
    expect(again.map((trigger) => trigger.trigger_id).sort()).toEqual(
      created.map((trigger) => trigger.trigger_id).sort(),
    );
    expect(await db.query.triggers.findMany()).toHaveLength(1);
  });

  it('removes the old workspace-wide memory_nightly trigger', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await create_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      trigger_type: 'schedule',
      trigger_name: 'Memory nightly dreaming',
      schedule_expression: '0 3 * * *',
      trigger_config: {
        starts_job_handler: 'memory_nightly',
        timezone: 'UTC',
        provisioning_key: 'memory_nightly_v1',
      },
      trigger_source: { kind: 'system' },
      actor_id: bootstrap.user_id,
    });

    await create_workspace_system_automation_triggers(db, {
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
    });

    const handlers = (await db.query.triggers.findMany()).map(
      (trigger) => trigger.trigger_config.starts_job_handler,
    );
    expect(handlers).toEqual(['run_attention_tick']);
  });

  it('creates the tick with the first automation of a fresh workspace', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    await create_workspace_automation(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
      automation_name: 'Weekly recap',
      instruction: 'Write the weekly recap.',
      triggers: [{ kind: 'manual' }],
    });

    const ticks = (await db.query.triggers.findMany()).filter(
      (trigger) => trigger.trigger_config.provisioning_key === 'attention_tick_v1',
    );
    expect(ticks).toHaveLength(1);
  });
});
