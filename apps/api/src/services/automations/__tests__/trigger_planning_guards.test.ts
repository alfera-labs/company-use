import { plan_automation_triggers } from '@api/services/automations/automation_triggers';
import type { Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, nodes } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

const composio_interval = {
  type: 'number',
  title: 'Interval',
  default: 1,
  description: 'Periodic Interval to Check for Updates & Send a Trigger in Minutes',
};

async function seed_polling_trigger_node(
  db: Database,
  interval_property: Record<string, unknown> = {
    type: 'number',
    minimum: 1,
    description: 'Minutes.',
  },
) {
  const audit = { created_by: 'test', last_updated_by: 'test' };
  await db.insert(apps).values({
    app_id: 'app_poll',
    app_name: 'poll_fixture',
    app_key: 'poll_fixture',
    app_display_name: 'Poll fixture',
    ...audit,
  });
  await db.insert(nodes).values({
    node_id: 'node_poll',
    app_id: 'app_poll',
    app_key: 'poll_fixture',
    node_name: 'new_message',
    node_key: 'poll_fixture-new_message-1',
    node_display_name: 'New message',
    node_kind: 'trigger',
    input_schema: {
      type: 'object',
      properties: { interval: interval_property },
    },
    runtime_handler: 'composio.trigger.POLL_NEW_MESSAGE',
    node_config: {
      composio: { toolkit_slug: 'poll_fixture', trigger_slug: 'POLL_NEW_MESSAGE' },
      sourced_from: { provider: 'composio', provider_app_id: 'gmail' },
    },
    ...audit,
  });
}

describe('number fields in subscription_config', () => {
  async function plan_with_interval(
    interval: unknown,
    interval_property?: Record<string, unknown>,
  ) {
    const db = await create_test_database();
    const workspace = await bootstrap_default_workspace(db);
    await seed_polling_trigger_node(db, interval_property);
    return plan_automation_triggers(
      db,
      {
        workspace_id: workspace.workspace_id,
        agent_id: workspace.agent_id,
        automation_id: 'atm_poll',
        created_via: 'user',
        automation_name: 'Read new messages',
        instruction: 'Read every new message.',
        actor_id: workspace.user_id,
      },
      [
        {
          kind: 'app_event',
          node_key: 'poll_fixture-new_message-1',
          subscription_config: { interval },
          conditions: [],
        },
      ],
    );
  }

  function planned_interval(planned: Awaited<ReturnType<typeof plan_with_interval>>) {
    return planned[0]?.row.trigger_config?.event_source?.subscription_config;
  }

  it('refuses a number below the minimum the schema declares, naming the field and the bound', async () => {
    await expect(plan_with_interval(0.5)).rejects.toThrow(
      'Trigger poll_fixture-new_message-1 needs interval to be at least 1',
    );
  });

  it("refuses a polling interval under Composio's one-minute floor that the schema never states", async () => {
    await expect(plan_with_interval(0.5, composio_interval)).rejects.toThrow(
      'Trigger poll_fixture-new_message-1 needs interval to be at least 1',
    );
    expect(planned_interval(await plan_with_interval(1, composio_interval))).toEqual({
      interval: 1,
    });
  });

  it('plans a number inside the bound', async () => {
    expect(planned_interval(await plan_with_interval(1))).toEqual({ interval: 1 });
  });

  it('reads a number sent as text before comparing it, and stores the number', async () => {
    await expect(plan_with_interval('0.5')).rejects.toThrow(
      'Trigger poll_fixture-new_message-1 needs interval to be at least 1',
    );
    expect(planned_interval(await plan_with_interval(' 5 '))).toEqual({ interval: 5 });
  });

  it('refuses text that is not a number, in words a person can act on', async () => {
    await expect(plan_with_interval('every hour')).rejects.toThrow(
      'Trigger poll_fixture-new_message-1 needs interval to be a number, not "every hour"',
    );
  });
});
