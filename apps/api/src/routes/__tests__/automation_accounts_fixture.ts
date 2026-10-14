import { create_app } from '@api/app';
import { trigger_wire_provisioners } from '@api/services/triggers/trigger_wire';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { apps, connections, nodes, resource_grants } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, vi } from 'vitest';

const audit = { created_by: 'test', last_updated_by: 'test' };
export const original_provisioner = trigger_wire_provisioners.composio;
export const provider = {
  create: vi.fn(async (_input: { connection_id?: string | undefined }) => ({
    provisioning_key: 'wire_test',
  })),
  set_enabled: vi.fn(async (_input: { provisioning_key: string; enabled: boolean }) => {}),
  delete: vi.fn(async (_input: { provisioning_key: string }) => {}),
};

export function mock_the_provider_wire() {
  beforeEach(() => {
    vi.resetAllMocks();
    provider.create.mockResolvedValue({ provisioning_key: 'wire_test' });
    trigger_wire_provisioners.composio = provider;
  });
  afterEach(() => {
    trigger_wire_provisioners.composio = original_provisioner;
  });
}

export async function create_fixture() {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  await claim_card_unlock(db, identity.workspace_id);
  await db.insert(apps).values({
    app_id: 'app_gmail',
    app_name: 'gmail_fixture',
    app_key: 'gmail_fixture',
    app_display_name: 'Gmail',
    ...audit,
  });
  await db.insert(nodes).values({
    node_id: 'node_gmail',
    app_id: 'app_gmail',
    app_key: 'gmail_fixture',
    node_name: 'new_message',
    node_key: 'gmail_fixture-new_message-1',
    node_display_name: 'New message',
    node_kind: 'trigger',
    input_schema: {},
    runtime_handler: 'composio.trigger.NEW_MESSAGE',
    node_config: { composio: { toolkit_slug: 'gmail_fixture', trigger_slug: 'NEW_MESSAGE' } },
    ...audit,
  });
  const connect = async (connection_id: string, connected_by: string, created_time: string) => {
    await db.insert(connections).values({
      connection_id,
      workspace_id: identity.workspace_id,
      app_id: 'app_gmail',
      connection_key: connection_id,
      connection_status: 'active',
      external_account_id: `account_${connection_id}`,
      connected_by,
      created_time: new Date(created_time),
      ...audit,
    });
  };
  const grant = async (connection_id: string, grantee_type: 'user' | 'project', id: string) => {
    await db.insert(resource_grants).values({
      resource_grant_id: create_id(id_prefixes.resource_grant),
      workspace_id: identity.workspace_id,
      resource_type: 'connection',
      resource_id: connection_id,
      grantee_type,
      grantee_id: id,
      grant_level: 'use',
      ...audit,
    });
  };
  const revoke = async (connection_id: string) => {
    const where = eq(connections.connection_id, connection_id);
    await db.update(connections).set({ connection_status: 'revoked' }).where(where);
  };
  return { db, identity, app: create_app(db), connect, grant, revoke };
}

export type Fixture = Awaited<ReturnType<typeof create_fixture>>;

export function mail_ear(subscription_config: Record<string, unknown>, connection_id?: string) {
  return {
    kind: 'app_event' as const,
    node_key: 'gmail_fixture-new_message-1',
    subscription_config,
    ...(connection_id ? { connection_id } : {}),
  };
}

export function send(fixture: Fixture, method: string, path: string, body?: unknown) {
  return fixture.app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function create_automation(fixture: Fixture, triggers: unknown[]) {
  return send(fixture, 'POST', '/v1/automations', {
    automation_name: 'Answer mail',
    instruction: 'Read the message and draft a reply for the person.',
    triggers,
  });
}

export async function stored_ears(fixture: Fixture, automation_id: string) {
  const ears = await list_automation_triggers(fixture.db, {
    workspace_id: fixture.identity.workspace_id,
    automation_id,
  });
  return ears.filter((ear) => ear.trigger_type === 'app_event');
}
