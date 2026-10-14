import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections, nodes, resource_grants } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';

export const audit = { created_by: 'test', last_updated_by: 'test' };
const mail_profile = {
  provider_key: 'composio',
  provider_config_key: 'composio:gmail',
  provider_config_version: 1,
  connection_profile_key: 'composio:gmail:managed_oauth',
  connection_profile_version: 1,
};
export const choices_url =
  '/v1/automations/trigger-types/gmail-message_received-1/fields/labelIds/choices?connection_id=conn_mail';

export async function create_fixture() {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  await db.insert(apps).values([
    {
      app_id: 'app_mail',
      app_name: 'gmail',
      app_key: 'gmail',
      app_display_name: 'Gmail',
      auth_type: 'oauth',
      ...audit,
    },
    {
      app_id: 'app_other',
      app_name: 'other',
      app_key: 'other',
      app_display_name: 'Other',
      auth_type: 'oauth',
      ...audit,
    },
  ]);
  await db.insert(nodes).values([
    {
      node_id: 'node_mail',
      app_id: 'app_mail',
      app_key: 'gmail',
      node_name: 'message_received',
      node_key: 'gmail-message_received-1',
      node_display_name: 'Message received',
      node_kind: 'trigger',
      input_schema: {
        type: 'object',
        properties: { labelIds: { type: 'string' }, query: { type: 'string' } },
      },
      node_config: { sourced_from: { provider_app_id: 'gmail' } },
      runtime_handler: 'composio.trigger.MESSAGE_RECEIVED',
      ...audit,
    },
    {
      node_id: 'node_other_labels',
      app_id: 'app_other',
      app_key: 'other',
      node_name: 'list_labels',
      node_key: 'other-list_labels-1',
      node_display_name: 'Other labels',
      node_kind: 'action',
      input_schema: {},
      runtime_handler: 'composio.action.LIST_LABELS',
      ...audit,
    },
    {
      node_id: 'node_labels',
      app_id: 'app_mail',
      app_key: 'gmail',
      node_name: 'list_labels',
      node_key: 'gmail-labels-in-this-env-7',
      node_display_name: 'List labels',
      node_kind: 'action',
      input_schema: {},
      output_schema: { type: 'object', properties: { options: { type: 'array' } } },
      runtime_handler: 'composio.action.LIST_LABELS',
      ...mail_profile,
      ...audit,
    },
  ]);
  await db.insert(connections).values({
    connection_id: 'conn_mail',
    workspace_id: identity.workspace_id,
    app_id: 'app_mail',
    connection_key: 'gmail',
    connection_status: 'active',
    external_account_name: 'Personal inbox',
    ...mail_profile,
    ...audit,
  });
  return { db, identity, app: create_app(db) };
}

export async function restrict_connection(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
  connection_id: string,
  user_id: string,
) {
  const workspace_id = fixture.identity.workspace_id;
  await fixture.db.insert(connections).values({
    connection_id,
    workspace_id,
    app_id: 'app_mail',
    connection_key: connection_id,
    connection_status: 'active',
    connected_by: user_id,
    ...mail_profile,
    ...audit,
  });
  await fixture.db.insert(resource_grants).values({
    resource_grant_id: create_id(id_prefixes.resource_grant),
    workspace_id,
    resource_type: 'connection',
    resource_id: connection_id,
    grantee_type: 'user',
    grantee_id: user_id,
    grant_level: 'use',
    ...audit,
  });
}
