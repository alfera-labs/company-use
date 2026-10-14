import { scout_config_key, scout_job_handler, scout_trigger_purpose } from '@coworker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_channels = vi.hoisted(() => ({
  find_primary_member_channel: vi.fn(async () => null),
}));

vi.mock('@runtime-platform/tools/slack/channels_api', async (import_original) => {
  const actual =
    await import_original<typeof import('@runtime-platform/tools/slack/channels_api')>();
  return {
    ...actual,
    find_primary_member_channel: slack_channels.find_primary_member_channel,
  };
});

const { create_app } = await import('@api/app');
const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');
const { get_cron_schedule } = await import('@api/services/scheduling/cron_schedule');

describe('onboarding and the scout trigger', () => {
  let cron_schedule: Awaited<ReturnType<typeof get_cron_schedule>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    slack_channels.find_primary_member_channel.mockClear();
    cron_schedule = await get_cron_schedule();
    vi.spyOn(cron_schedule, 'set_schedule');
  });

  it('provisions one workspace scout trigger when onboarding completes', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const response = await app.request('/v1/onboarding/complete', { method: 'POST' });

    expect(response.status).toBe(200);
    const scout = await find_scout_trigger(db, bootstrap.workspace_id);
    expect(scout).toMatchObject({
      agent_id: bootstrap.agent_id,
      trigger_name: 'Agent scout',
      trigger_type: 'schedule',
      trigger_status: 'enabled',
      schedule_expression: '35 8,11,14,17 * * 1-5',
      trigger_source: {
        kind: 'system',
        source: 'onboarding_complete',
        purpose: scout_trigger_purpose,
      },
      trigger_config: {
        starts_job_handler: scout_job_handler,
        timezone: 'UTC',
        [scout_config_key]: {
          version: 1,
          mode: 'autonomous_agent',
          max_output_tokens: 1600,
          recent_message_limit: 30,
          max_actions: 3,
        },
      },
    });
    expect(slack_channels.find_primary_member_channel).not.toHaveBeenCalled();
    expect(cron_schedule.set_schedule).toHaveBeenCalledTimes(1);
    expect(cron_schedule.set_schedule).toHaveBeenCalledWith({
      trigger_id: scout?.trigger_id,
      cron_expression: '35 8,11,14,17 * * 1-5',
      timezone: 'UTC',
    });

    await app.request('/v1/onboarding/complete', { method: 'POST' });

    const triggers = await list_scout_triggers(db, bootstrap.workspace_id);
    expect(triggers).toHaveLength(1);
    expect(cron_schedule.set_schedule).toHaveBeenCalledTimes(2);
  });
});

async function find_scout_trigger(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
) {
  return (await list_scout_triggers(db, workspace_id))[0] ?? null;
}

async function list_scout_triggers(
  db: Awaited<ReturnType<typeof create_test_database>>,
  workspace_id: string,
) {
  const triggers = await db.query.triggers.findMany({
    where: (table, { eq }) => eq(table.workspace_id, workspace_id),
  });
  return triggers.filter((trigger) => {
    const config = trigger.trigger_config as Record<string, unknown>;
    return config.starts_job_handler === scout_job_handler && Boolean(config[scout_config_key]);
  });
}
