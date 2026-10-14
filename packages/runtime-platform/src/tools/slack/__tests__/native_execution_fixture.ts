import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { update_agent_enabled_nodes } from '@coworker/core/db/queries/connection_management';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { connections } from '@coworker/core/db/schema';
import { encrypt_connection_credentials } from '@coworker/core/integrations/credential_envelope';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';

export async function create_fixture(
  input: {
    actor_id?: string;
    environment?: Parameters<typeof create_runtime_tool_definitions>[1]['environment'];
    source_context?: Parameters<typeof create_runtime_tool_definitions>[1]['source_context'];
  } = {},
) {
  process.env.COWORKER_CREDENTIAL_ENCRYPTION_KEY = 'native-slack-test-key';
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);

  const slack_app = await db.query.apps.findFirst({
    where: (table, { eq }) => eq(table.app_name, 'slack'),
  });
  const list_channels = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'slack-list_channels-1'),
  });
  const send_message = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'slack-send_message-1'),
  });
  const join_channel = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'slack-join_channel-1'),
  });
  const upload_file = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'slack-upload_file-1'),
  });
  const read_history = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'slack-read_history-1'),
  });
  const list_workspace_members = await db.query.nodes.findFirst({
    where: (table, { eq }) => eq(table.node_key, 'slack-list_workspace_members-1'),
  });
  if (
    !slack_app ||
    !list_channels ||
    !send_message ||
    !join_channel ||
    !upload_file ||
    !read_history ||
    !list_workspace_members
  ) {
    throw new Error('Slack catalog seed failed');
  }

  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: input.actor_id ?? bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: input.actor_id ?? bootstrap.user_id,
  });

  await db.insert(connections).values({
    connection_id: 'conn_native_slack',
    workspace_id: bootstrap.workspace_id,
    app_id: slack_app.app_id,
    connection_name: 'Native Slack test',
    connection_status: 'active',
    connection_key: 'native:slack:conn_native_slack',
    provider_key: 'native',
    provider_config_key: 'native:slack',
    provider_config_version: 1,
    connection_profile_key: 'native:slack:oauth_bot',
    connection_profile_version: 1,
    auth_method_key: 'slack_oauth2_bot',
    external_account_id: 'T123',
    external_account_name: 'Test workspace',
    authorized_scopes: [
      'channels:read',
      'channels:join',
      'channels:history',
      'chat:write',
      'files:read',
      'files:write',
      'im:write',
      'users:read',
      'users:read.email',
    ],
    health_status: 'healthy',
    credentials: encrypt_connection_credentials({
      credential_source: 'oauth2',
      values: { access_token: 'xoxb-test' },
    }),
    provider_account: { team_id: 'T123' },
    metadata: {},
    created_by: bootstrap.user_id,
    last_updated_by: bootstrap.user_id,
  });
  await update_agent_enabled_nodes(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
    enabled_nodes: [
      enabled_node('slack-list_channels-1'),
      enabled_node('slack-join_channel-1'),
      enabled_node('slack-send_message-1'),
      enabled_node('slack-upload_file-1'),
      enabled_node('slack-read_history-1'),
      enabled_node('slack-list_workspace_members-1'),
    ],
  });

  const tools = create_runtime_tool_definitions(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    agent_id: bootstrap.agent_id,
    actor_id: input.actor_id ?? bootstrap.user_id,
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.source_context ? { source_context: input.source_context } : {}),
  });
  const tool = tools.find((definition) => definition.tool_name === 'runtime-execute_tool-1');
  if (!tool?.execute) throw new Error('runtime-execute_tool-1 was not registered');

  return {
    db,
    bootstrap,
    session,
    run,
    execute_tool: tool.execute,
    slack_nodes: {
      list_channels,
      join_channel,
      send_message,
      upload_file,
      read_history,
      list_workspace_members,
    },
  };
}

function enabled_node(node_key: string) {
  return {
    node_key,
    provider_key: 'native' as const,
    status: 'enabled' as const,
    connection_selector: { strategy: 'latest_active_matching_connection' as const },
    input_defaults: {},
    approval_policy_override: null,
  };
}
