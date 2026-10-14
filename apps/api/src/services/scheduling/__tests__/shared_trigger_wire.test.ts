import { describe, expect, it, vi } from 'vitest';

const composio = {
  create_composio_trigger_instance: vi.fn(async () => ({ trigger_id: 'ti_shared' })),
  set_composio_trigger_instance_enabled: vi.fn(async () => {}),
  delete_composio_trigger_instance: vi.fn(async () => {}),
};
vi.mock('@runtime-platform/composio/composio_triggers', () => composio);
vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => ({
    supports_run_once: true,
    set_schedule: vi.fn(async () => {}),
    pause_schedule: vi.fn(async () => {}),
    delete_schedule: vi.fn(async () => {}),
  }),
}));

const { remove_trigger, set_trigger_status } = await import(
  '@api/services/scheduling/trigger_lifecycle'
);
const { create_trigger } = await import('@coworker/core/db/queries/trigger_writes');
const { create_test_database } = await import('@coworker/core/db/__tests__/test_database');
const { bootstrap_default_workspace } = await import('@coworker/core/db/queries/bootstrap');

const shared_key = 'ti_shared';

async function two_automations_on_one_ear() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const made = [];
  for (const trigger_name of ['Billing questions', 'Pay the invoices']) {
    made.push(
      await create_trigger(db, {
        workspace_id: bootstrap.workspace_id,
        agent_id: bootstrap.agent_id,
        trigger_name,
        trigger_type: 'app_event',
        trigger_config: {
          starts_job_handler: 'run_automation',
          provisioned_by: 'composio',
          provisioning_key: shared_key,
          event_source: {
            node_key: 'composio_gmail-new_gmail_message-1',
            trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
            connection_id: 'conn_test',
          },
        },
        trigger_status: 'enabled',
        actor_id: bootstrap.user_id,
      }),
    );
  }
  const [first, second] = made;
  if (!first || !second) throw new Error('both triggers are required');
  return { db, workspace_id: bootstrap.workspace_id, actor_id: bootstrap.user_id, first, second };
}

describe('a Composio wire two automations share', () => {
  it('survives deleting one automation, and goes only with the last one', async () => {
    const { db, workspace_id, first, second } = await two_automations_on_one_ear();

    await remove_trigger(db, { workspace_id, trigger_id: first.trigger_id });
    expect(composio.delete_composio_trigger_instance).not.toHaveBeenCalled();

    await remove_trigger(db, { workspace_id, trigger_id: second.trigger_id });
    expect(composio.delete_composio_trigger_instance).toHaveBeenCalledWith({
      trigger_id: shared_key,
    });
    expect(await db.query.triggers.findMany()).toHaveLength(0);
  });

  it('stays enabled at the provider when one of the two automations is paused', async () => {
    const { db, workspace_id, actor_id, first, second } = await two_automations_on_one_ear();
    composio.set_composio_trigger_instance_enabled.mockClear();

    const paused = await set_trigger_status(db, {
      workspace_id,
      trigger_id: first.trigger_id,
      trigger_status: 'disabled',
      actor_id,
    });
    expect(paused.trigger_status).toBe('disabled');
    expect(composio.set_composio_trigger_instance_enabled).not.toHaveBeenCalled();

    await set_trigger_status(db, {
      workspace_id,
      trigger_id: second.trigger_id,
      trigger_status: 'disabled',
      actor_id,
    });
    expect(composio.set_composio_trigger_instance_enabled).toHaveBeenCalledWith({
      trigger_id: shared_key,
      enabled: false,
    });
  });
});
