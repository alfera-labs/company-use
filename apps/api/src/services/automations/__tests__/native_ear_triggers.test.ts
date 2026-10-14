import { plan_automation_triggers } from '@api/services/automations/automation_triggers';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import {
  native_trigger_node_keys,
  seed_native_trigger_catalog,
} from '@runtime-platform/tools/native_trigger_seed';
import { describe, expect, it } from 'vitest';

describe('planning an automation trigger on a native ear', () => {
  it('needs no connection and leaves nothing to provision', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    await seed_native_trigger_catalog(db);

    const [planned] = await plan_automation_triggers(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        agent_id: bootstrap.agent_id,
        automation_id: 'atm_native_ear',
        created_via: 'user',
        automation_name: 'Answer the mail',
        instruction: 'Answer anyone who writes in.',
        actor_id: bootstrap.user_id,
      },
      [
        {
          kind: 'app_event',
          node_key: native_trigger_node_keys.inbound_email,
          subscription_config: {},
          conditions: [{ field: 'sender', operation: 'contains_any_of', values: ['@example.com'] }],
        },
      ],
    );

    expect(planned?.connected_account_id).toBeNull();
    expect(planned?.row.trigger_type).toBe('app_event');
    expect(planned?.row.trigger_config).toEqual({
      starts_job_handler: 'run_automation',
      event_source: { node_key: native_trigger_node_keys.inbound_email },
      rules: [{ field: 'sender', operation: 'contains_any_of', values: ['@example.com'] }],
    });
    expect(planned?.row.trigger_config?.provisioned_by).toBeUndefined();
  });

  it('refuses a node key that is not a trigger at all', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    await seed_runtime_tool_catalog(db);
    await seed_native_trigger_catalog(db);

    await expect(
      plan_automation_triggers(
        db,
        {
          workspace_id: bootstrap.workspace_id,
          agent_id: bootstrap.agent_id,
          automation_id: 'atm_native_ear',
          created_via: 'user',
          automation_name: 'Answer the mail',
          instruction: 'Answer anyone who writes in.',
          actor_id: bootstrap.user_id,
        },
        [
          {
            kind: 'app_event',
            node_key: 'notifications-write_notification-1',
            subscription_config: {},
            conditions: [],
          },
        ],
      ),
    ).rejects.toThrow('cannot create an event subscription');
  });
});
