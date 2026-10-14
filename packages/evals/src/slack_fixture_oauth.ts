import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  create_pending_connection_setup,
  revoke_connection,
} from '@coworker/core/db/queries/connection_management';
import { default_browser_command } from '@coworker/evals/slack_eval_browser_defaults';
import { create_browser_command } from '@coworker/evals/slack_eval_sender';
import type { SlackEvalFixture } from '@coworker/evals/slack_fixture_manifest';
import {
  find_active_slack_connection_for_workspace,
  find_native_slack_app,
} from '@runtime-platform/channels/slack/workspace_connection';
import { build_public_connection_setup } from '@runtime-platform/connections/oauth_connection_setup';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import {
  create_slack_web_client,
  fetch_public_slack_channels,
  join_slack_channel,
  read_slack_authed_user_id,
  read_slack_bot_token,
  type SlackCredentialConnection,
} from '@runtime-platform/tools/slack/channels_api';

export async function open_slack_fixture_oauth(db: Database, fixture: SlackEvalFixture) {
  if (!fixture.product_workspace_id || !fixture.product_user_id) {
    throw new Error(`${fixture.task_id} product fixture is not provisioned`);
  }
  const app = await find_native_slack_app(db);
  if (!app) throw new Error('Native Slack app is missing from the catalog');
  const redirect_uri = new URL('/connect/callback?source=slack', require_eval_app_url()).toString();
  const pending = await create_pending_connection_setup(db, {
    workspace_id: fixture.product_workspace_id,
    actor_id: fixture.product_user_id,
    app_id: app.app_id,
    provider_key: native_slack_provider_key,
    provider_config_key: native_slack_provider_config_key,
    connection_profile_key: native_slack_connection_profile_key,
    redirect_uri,
  });
  const setup = await build_public_connection_setup({
    provider_key: pending.connection.provider_key,
    setup_state: pending.setup,
    db,
    redirect_uri,
    request_origin: new URL(redirect_uri).origin,
  });
  const authorization_url = (setup as { authorization_url?: string }).authorization_url;
  if (!authorization_url) throw new Error('Slack OAuth setup did not return an authorization URL');
  const run_browser_command = create_browser_command(
    env.SLACK_EVAL_BROWSER_COMMAND ?? default_browser_command,
  );
  if (!fixture.slack_team_id) throw new Error(`${fixture.task_id} Slack workspace is not recorded`);
  await run_browser_command([
    'newtab',
    fixture_slack_authorization_url(authorization_url, fixture.slack_team_id),
  ]);
}

export function fixture_slack_authorization_url(value: string, team_id?: string) {
  const url = new URL(value);
  if (url.origin !== 'https://slack.com' || url.pathname !== '/oauth/v2/authorize') {
    throw new Error('Slack fixture authorization URL must use slack.com/oauth/v2/authorize');
  }
  url.searchParams.delete('team');
  if (team_id) url.searchParams.set('team', team_id);
  return url.toString();
}

export async function finalize_slack_fixture(db: Database, fixture: SlackEvalFixture) {
  if (!fixture.product_workspace_id || !fixture.product_user_id) {
    throw new Error(`${fixture.task_id} product fixture is not provisioned`);
  }
  const connection = await find_active_slack_connection_for_workspace(
    db,
    fixture.product_workspace_id,
  );
  if (!connection) throw new Error(`${fixture.task_id} Slack OAuth is not complete`);
  if (!fixture.slack_team_id) throw new Error(`${fixture.task_id} Slack workspace is not recorded`);
  if (connection.external_account_id !== fixture.slack_team_id) {
    await revoke_connection(db, {
      workspace_id: fixture.product_workspace_id,
      connection_id: connection.connection_id,
      actor_id: fixture.product_user_id,
    });
    throw new Error(
      `${fixture.task_id} Slack OAuth installed team ${connection.external_account_id ?? 'unknown'}, expected ${fixture.slack_team_id}`,
    );
  }
  const token = read_slack_bot_token(connection);
  if (!token) throw new Error(`${fixture.task_id} Slack connection has no bot token`);
  await verify_installer_email(token, connection, fixture.slack_actor_email);
  const channel = await select_fixture_channel(token);
  await join_slack_channel(token, channel.id);
  return {
    ...fixture,
    status: 'ready' as const,
    slack_team_id: fixture.slack_team_id,
    slack_channel_id: channel.id,
    slack_workspace_url: `https://app.slack.com/client/${fixture.slack_team_id}/${channel.id}`,
  };
}

async function verify_installer_email(
  token: string,
  connection: SlackCredentialConnection,
  expected_email: string,
) {
  const installer_user_id = read_slack_authed_user_id(connection);
  if (!installer_user_id) throw new Error('Slack connection has no installer user id');
  const response = await create_slack_web_client(token).users.info({ user: installer_user_id });
  const email = response.user?.profile?.email?.toLowerCase();
  if (email !== expected_email.toLowerCase()) {
    throw new Error(`Slack installer email ${email ?? 'unknown'} does not match ${expected_email}`);
  }
}

async function select_fixture_channel(token: string) {
  const page = await fetch_public_slack_channels(token, { limit: 200 });
  const channel = page.channels.find((item) => item.name === 'general') ?? page.channels[0];
  if (!channel) throw new Error('Slack workspace has no public channel');
  return channel;
}

function require_eval_app_url() {
  if (!env.SLACK_EVAL_APP_URL) throw new Error('SLACK_EVAL_APP_URL is required');
  return env.SLACK_EVAL_APP_URL;
}
