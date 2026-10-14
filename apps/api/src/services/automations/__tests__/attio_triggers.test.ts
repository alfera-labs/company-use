import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.COMPOSIO_API_KEY = 'composio_test_key';
});

import {
  create_workspace_automation,
  delete_workspace_automation,
} from '@api/services/automations/automation_service';
import { plan_automation_triggers } from '@api/services/automations/automation_triggers';
import { apps, type Database } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { connections } from '@coworker/core/db/schema';
import { reset_composio_client_for_tests } from '@runtime-platform/composio/composio_client';
import { seed_attio_trigger_catalog } from '@runtime-platform/tools/attio_trigger_seed';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const companies_object_id = '0b1e4f6a-2f2c-4f6a-9d3e-6a1c2b3d4e5f';
const composio_account_id = 'ca_attio';
const composio_user_id = 'ws_external_attio';

type ComposioCall = { tool_slug: string; body: Record<string, unknown> };

function stub_composio_attio_actions() {
  const calls: ComposioCall[] = [];
  const answers: Record<string, unknown> = {
    ATTIO_GET_OBJECT: { data: { id: { object_id: companies_object_id }, api_slug: 'companies' } },
    ATTIO_CREATE_WEBHOOK: {
      data: {
        id: { workspace_id: 'ws_attio', webhook_id: 'webhook_1' },
        secret: 'attio_delivery_secret',
        status: 'active',
      },
    },
    ATTIO_DELETE_WEBHOOK: {},
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit) => {
      const tool_slug = String(url).split('/tools/execute/')[1] ?? '';
      calls.push({ tool_slug, body: JSON.parse(String(init.body)) });
      if (!(tool_slug in answers)) throw new Error(`No stubbed Composio action ${String(url)}`);
      return json_answer({ successful: true, data: answers[tool_slug], log_id: 'log_1' });
    }),
  );
  return calls;
}

function json_answer(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function connect_composio_attio(db: Database) {
  const bootstrap = await bootstrap_default_workspace(db);
  const [app] = await db
    .insert(apps)
    .values({
      app_id: 'app_composio_attio',
      app_name: 'attio_v2',
      app_key: 'attio_v2',
      catalog_scope: 'global',
      app_display_name: 'Attio',
      app_category: 'crm',
      auth_type: 'oauth2',
      app_status: 'active',
      metadata: {
        source: 'composio',
        sourced_from: { provider: 'composio', provider_app_slug: 'attio' },
      },
      created_by: 'system:test',
      last_updated_by: 'system:test',
    })
    .returning();
  if (!app) throw new Error('the Composio Attio app was not written');
  await seed_attio_trigger_catalog(db);
  const [connection] = await db
    .insert(connections)
    .values({
      connection_id: 'con_composio_attio',
      workspace_id: bootstrap.workspace_id,
      app_id: app.app_id,
      connection_key: 'composio:attio:con_composio_attio',
      connection_name: 'Attio',
      connection_status: 'active',
      provider_key: 'composio',
      provider_config_key: 'composio:attio',
      connection_profile_key: 'composio:attio:oauth2',
      external_account_id: composio_account_id,
      external_user_key: composio_user_id,
      health_status: 'healthy',
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    })
    .returning();
  if (!connection) throw new Error('the Attio connection was not written');
  return { bootstrap, connection_id: connection.connection_id };
}

function attio_automation_input(bootstrap: {
  workspace_id: string;
  agent_id: string;
  user_id: string;
}) {
  return {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    automation_name: 'Greet new companies',
    instruction: 'Write a short welcome note for every new company.',
    triggers: [
      {
        kind: 'app_event' as const,
        node_key: 'attio-record_created-1',
        subscription_config: { object: 'companies' },
        conditions: [],
      },
    ],
  };
}

describe('an Attio ear', () => {
  beforeEach(() => {
    reset_composio_client_for_tests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    reset_composio_client_for_tests();
  });

  it('plans a row the attio provisioner owns, bound to the Composio Attio connection', async () => {
    const db = await create_test_database();
    const { bootstrap, connection_id } = await connect_composio_attio(db);

    const [planned] = await plan_automation_triggers(
      db,
      {
        workspace_id: bootstrap.workspace_id,
        agent_id: bootstrap.agent_id,
        automation_id: 'atm_attio',
        created_via: 'user',
        automation_name: 'Greet new companies',
        instruction: 'Write a short welcome note for every new company.',
        actor_id: bootstrap.user_id,
      },
      [
        {
          kind: 'app_event',
          node_key: 'attio-record_created-1',
          subscription_config: { object: 'companies' },
          conditions: [],
        },
      ],
    );

    expect(planned?.row.trigger_config?.provisioned_by).toBe('attio');
    expect(planned?.row.trigger_config?.event_source).toEqual({
      node_key: 'attio-record_created-1',
      trigger_slug: 'record.created',
      connection_id,
      subscription_config: { object: 'companies' },
    });
    expect(planned?.connected_account_id).toBe(composio_account_id);
    expect(planned?.row.trigger_config?.needs_connection).toBeUndefined();
  });

  it('creates the webhook on Attio and keeps the secret it is only shown once', async () => {
    const db = await create_test_database();
    const { bootstrap } = await connect_composio_attio(db);
    const calls = stub_composio_attio_actions();

    const created = await create_workspace_automation(db, attio_automation_input(bootstrap));
    const [trigger] = await list_automation_triggers(db, {
      workspace_id: bootstrap.workspace_id,
      automation_id: created.automation.automation_id,
    });

    expect(trigger?.trigger_config.provisioning_key).toBe('webhook_1');
    expect(trigger?.trigger_config.webhook_secret).toBe('attio_delivery_secret');
    expect(trigger?.trigger_config.attio_object_id).toBe(companies_object_id);
    expect(trigger?.trigger_config.provisioning_error).toBeUndefined();

    expect(calls.map((call) => call.tool_slug)).toEqual([
      'ATTIO_GET_OBJECT',
      'ATTIO_CREATE_WEBHOOK',
    ]);
    expect(calls[0]?.body).toEqual({
      connected_account_id: composio_account_id,
      user_id: composio_user_id,
      arguments: { object: 'companies' },
      version: 'latest',
    });
    const create_arguments = calls[1]?.body.arguments as {
      target_url: string;
      subscriptions: { event_type: string; filter: unknown }[];
    };
    expect(calls[1]?.body.connected_account_id).toBe(composio_account_id);
    expect(create_arguments.target_url).toMatch(
      new RegExp(`/v1/triggers/deliveries/attio/${trigger?.trigger_id}$`, 'u'),
    );
    expect(create_arguments.subscriptions).toEqual([
      { event_type: 'record.created', filter: null },
    ]);
  });

  it('deletes the webhook on Attio when the automation is retired', async () => {
    const db = await create_test_database();
    const { bootstrap } = await connect_composio_attio(db);
    const calls = stub_composio_attio_actions();
    const created = await create_workspace_automation(db, attio_automation_input(bootstrap));

    await delete_workspace_automation(db, {
      workspace_id: bootstrap.workspace_id,
      automation_id: created.automation.automation_id,
      actor_id: bootstrap.user_id,
    });

    expect(calls.at(-1)).toEqual({
      tool_slug: 'ATTIO_DELETE_WEBHOOK',
      body: {
        connected_account_id: composio_account_id,
        user_id: composio_user_id,
        arguments: { webhook_id: 'webhook_1' },
        version: 'latest',
      },
    });
  });
});
