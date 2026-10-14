import { create_workspace_scout_trigger } from '@api/services/scout/scout_provisioning';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import {
  bootstrap_default_workspace,
  upsert_default_agent_for_workspace,
} from '@coworker/core/db/queries/bootstrap';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import {
  scout_config_key,
  scout_job_handler,
  scout_provisioning_actor,
  scout_provisioning_key,
  scout_trigger_purpose,
} from '@coworker/shared';
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

describe('scout trigger reprovisioning', () => {
  beforeEach(() => {
    cron.set_schedule.mockReset();
  });

  it('re-asserts the cloud schedule for an existing enabled scout trigger', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const agent = await upsert_default_agent_for_workspace(db, {
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
    });
    const trigger = await create_scout_trigger_row(db, bootstrap.workspace_id, agent.agent_id);

    const result = await create_workspace_scout_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
    });

    expect(result?.trigger_id).toBe(trigger.trigger_id);
    expect(cron.set_schedule).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_id: trigger.trigger_id }),
    );
  });

  it('gives a new scout the workspace its own minute instead of the shared :01', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);

    const trigger = await create_workspace_scout_trigger(db, {
      workspace_id: bootstrap.workspace_id,
      actor_id: bootstrap.user_id,
    });

    expect(bootstrap.workspace_id).toBe('ws_1');
    expect(trigger.schedule_expression).toBe('35 8,11,14,17 * * 1-5');
  });
});

function create_scout_trigger_row(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
  agent_id: string,
) {
  return create_trigger(db, {
    workspace_id,
    agent_id,
    trigger_name: 'Agent scout',
    trigger_type: 'schedule',
    schedule_expression: '1 8,11,14,17 * * 1-5',
    trigger_config: {
      starts_job_handler: scout_job_handler,
      timezone: 'UTC',
      provisioning_key: scout_provisioning_key,
      [scout_config_key]: { version: 1 },
    },
    trigger_source: { kind: 'system', source: 'test', purpose: scout_trigger_purpose },
    trigger_target: { kind: 'agent_run', agent_id },
    actor_id: scout_provisioning_actor,
  });
}
