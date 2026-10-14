import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { connections, triggers, workspaces } from '@coworker/core/db/schema';
import { scout_job_handler } from '@coworker/shared';
import {
  clear_slack_user_directory_cache,
  load_slack_user_directory,
  type SlackMember,
} from '@runtime-platform/channels/slack/directory';
import { eq } from 'drizzle-orm';
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

vi.mock('@coworker/runtime-platform', async (import_original) => {
  const actual = await import_original<typeof import('@coworker/runtime-platform')>();
  return {
    ...actual,
    find_primary_member_channel: async () => ({ id: 'C_GENERAL', name: 'general' }),
  };
});

const { provision_missing_workspace_triggers } = await import(
  '@api/services/provisioning/workspace_trigger_reconcile'
);

const bot_token = 'reconcile-test-bot-token';

describe('workspace trigger reconcile', () => {
  beforeEach(() => {
    cron_schedule.set_schedule.mockClear();
    clear_slack_user_directory_cache();
  });

  it('backfills the scout trigger for slack-connected workspaces', async () => {
    const db = await create_test_database();
    const workspace = await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');

    const result = await provision_missing_workspace_triggers(db);
    const rows = await db.query.triggers.findMany();

    expect(result).toEqual({ workspaces_checked: 1, workspaces_reconciled: 1 });
    const configs = rows.map((row) => row.trigger_config as Record<string, unknown>);
    expect(configs.map((config) => config.starts_job_handler).sort()).toEqual(
      [scout_job_handler, 'run_attention_tick'].sort(),
    );
    for (const config of configs) expect(config.timezone).toBe('Europe/London');
    expect(rows.every((row) => row.workspace_id === workspace.workspace_id)).toBe(true);
  });

  it('re-asserts the cloud schedule for an existing scout trigger', async () => {
    const db = await create_test_database();
    const workspace = await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');

    await provision_missing_workspace_triggers(db);
    const rows = await db.query.triggers.findMany();
    expect(rows).toHaveLength(2);

    await db
      .update(workspaces)
      .set({ workspace_data: {} })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));
    cron_schedule.set_schedule.mockClear();

    const result = await provision_missing_workspace_triggers(db);

    expect(result).toEqual({ workspaces_checked: 1, workspaces_reconciled: 1 });
    expect(await db.query.triggers.findMany()).toHaveLength(2);
    expect(cron_schedule.set_schedule).toHaveBeenCalledTimes(2);
    for (const row of rows) {
      expect(cron_schedule.set_schedule).toHaveBeenCalledWith(
        expect.objectContaining({ trigger_id: row.trigger_id }),
      );
    }
  });

  it('carries a schedule the backfill rewrote through to the cloud scheduler', async () => {
    const db = await create_test_database();
    const workspace = await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');
    await provision_missing_workspace_triggers(db);

    await db
      .update(triggers)
      .set({ schedule_expression: '47 8,11,14,17 * * 1-5' })
      .where(eq(triggers.workspace_id, workspace.workspace_id));
    await db
      .update(workspaces)
      .set({ workspace_data: {} })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));
    cron_schedule.set_schedule.mockClear();

    await provision_missing_workspace_triggers(db);

    for (const row of await db.query.triggers.findMany()) {
      expect(cron_schedule.set_schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger_id: row.trigger_id,
          cron_expression: '47 8,11,14,17 * * 1-5',
        }),
      );
    }
  });

  it('releases the claim on provisioning failure so the same day retries', async () => {
    const db = await create_test_database();
    await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');
    cron_schedule.set_schedule.mockRejectedValueOnce(new Error('the scheduler is down'));

    const failed = await provision_missing_workspace_triggers(db);
    expect(failed).toEqual({ workspaces_checked: 1, workspaces_reconciled: 0 });

    const retried = await provision_missing_workspace_triggers(db);
    const rows = await db.query.triggers.findMany();

    expect(retried).toEqual({ workspaces_checked: 1, workspaces_reconciled: 1 });
    expect(rows).toHaveLength(2);
  });

  it('a second sweep the same day is blocked by the daily claim', async () => {
    const db = await create_test_database();
    await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');

    await provision_missing_workspace_triggers(db);
    const second = await provision_missing_workspace_triggers(db);
    const rows = await db.query.triggers.findMany();

    expect(second).toEqual({ workspaces_checked: 1, workspaces_reconciled: 0 });
    expect(rows).toHaveLength(2);
  });

  it('re-runs once when the older reprovision claim exists', async () => {
    const db = await create_test_database();
    const workspace = await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');
    const today = new Date().toISOString().slice(0, 10);

    await db
      .update(workspaces)
      .set({
        workspace_data: {
          trigger_reconcile_date: today,
          trigger_reconcile_key: `${today}:schedule-reprovision-v2`,
        },
        last_updated_time: new Date(),
        last_updated_by: 'old-reconciler',
      })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));

    const result = await provision_missing_workspace_triggers(db);
    const [updated_workspace] = await db
      .select({ workspace_data: workspaces.workspace_data })
      .from(workspaces)
      .where(eq(workspaces.workspace_id, workspace.workspace_id));
    const rows = await db.query.triggers.findMany();

    expect(result).toEqual({ workspaces_checked: 1, workspaces_reconciled: 1 });
    expect(rows).toHaveLength(2);
    expect(updated_workspace?.workspace_data).toMatchObject({
      trigger_reconcile_date: today,
      trigger_reconcile_key: `${today}:attention-tick-v1`,
    });
  });

  it('re-runs once when only the older unversioned daily claim exists', async () => {
    const db = await create_test_database();
    const workspace = await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');
    const today = new Date().toISOString().slice(0, 10);

    await db
      .update(workspaces)
      .set({
        workspace_data: { trigger_reconcile_date: today },
        last_updated_time: new Date(),
        last_updated_by: 'old-reconciler',
      })
      .where(eq(workspaces.workspace_id, workspace.workspace_id));

    const result = await provision_missing_workspace_triggers(db);
    const [updated_workspace] = await db
      .select({ workspace_data: workspaces.workspace_data })
      .from(workspaces)
      .where(eq(workspaces.workspace_id, workspace.workspace_id));
    const rows = await db.query.triggers.findMany();

    expect(result).toEqual({ workspaces_checked: 1, workspaces_reconciled: 1 });
    expect(rows).toHaveLength(2);
    expect(updated_workspace?.workspace_data).toMatchObject({
      trigger_reconcile_date: today,
      trigger_reconcile_key: `${today}:attention-tick-v1`,
    });
  });

  it('ignores workspaces without an active slack connection', async () => {
    const db = await create_test_database();
    await provision_workspace_for_identity(db, identity_input());

    const result = await provision_missing_workspace_triggers(db);
    const rows = await db.query.triggers.findMany();

    expect(result).toEqual({ workspaces_checked: 0, workspaces_reconciled: 0 });
    expect(rows).toHaveLength(0);
  });
});

async function seed_slack_workspace(db: Awaited<ReturnType<typeof create_test_database>>) {
  const workspace = await provision_workspace_for_identity(db, identity_input());
  await db.insert(connections).values({
    connection_id: 'conn_reconcile_slack',
    workspace_id: workspace.workspace_id,
    app_id: 'app_slack_test',
    connection_name: 'Slack reconcile test',
    connection_status: 'active',
    connection_key: 'native:slack:reconcile-test',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T_RECONCILE',
    external_account_name: 'Reconcile test workspace',
    authorized_scopes: ['chat:write'],
    health_status: 'healthy',
    credentials: { bot_token },
    provider_account: { team_id: 'T_RECONCILE' },
    metadata: {},
    created_by: 'user_reconcile',
    last_updated_by: 'user_reconcile',
  });
  return workspace;
}

function identity_input() {
  return {
    provider_key: 'workos',
    provider_user_id: 'user_reconcile',
    organization_id: 'org_reconcile',
    email: 'reconcile@example.com',
    first_name: 'Reconcile',
    last_name: 'Tester',
  };
}

async function warm_directory_cache(timezone: string) {
  await load_slack_user_directory(bot_token, Date.now(), async () => ({
    members: [member('U1', timezone), member('U2', timezone)],
    name_by_id: new Map(),
    truncated: false,
    loaded_pages: 1,
  }));
}

function member(user_id: string, timezone: string): SlackMember {
  return {
    user_id,
    real_name: user_id,
    display_name: null,
    email: null,
    timezone,
    is_bot: false,
    is_guest: false,
  };
}

describe('retired system schedules', () => {
  it('removes the four chore rows the tick replaced', async () => {
    const db = await create_test_database();
    const workspace = await seed_slack_workspace(db);
    await warm_directory_cache('Europe/London');
    const { create_trigger } = await import('@coworker/core/db/queries/trigger_writes');
    const agent = await db.query.agents.findFirst();
    for (const key of ['daily_summary_v1', 'automation_watchdog_v1']) {
      await create_trigger(db, {
        workspace_id: workspace.workspace_id,
        agent_id: agent?.agent_id ?? 'agt_missing',
        trigger_name: key,
        trigger_type: 'schedule',
        schedule_expression: '13,28,43,58 * * * *',
        trigger_config: {
          starts_job_handler: 'run_daily_summary',
          provisioning_key: key,
          timezone: 'Europe/London',
        },
        trigger_source: { kind: 'system', source: 'system_automation_provisioning' },
        actor_id: 'system',
      });
    }
    await provision_missing_workspace_triggers(db);
    const keys = (await db.query.triggers.findMany())
      .map((row) => row.trigger_config?.provisioning_key ?? row.trigger_config?.starts_job_handler)
      .sort();
    expect(keys).not.toContain('daily_summary_v1');
    expect(keys).not.toContain('automation_watchdog_v1');
    expect(keys).toContain('attention_tick_v1');
  });
});
