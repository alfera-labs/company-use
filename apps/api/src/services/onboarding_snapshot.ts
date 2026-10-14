import { work_email_domain } from '@api/services/onboarding_email_domain';
import { onboarding_jobs_that_need_no_app } from '@api/services/onboarding_jobs_that_need_no_app';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  get_onboarding_identity,
  get_onboarding_record,
} from '@coworker/core/db/queries/onboarding';
import { get_user } from '@coworker/core/db/queries/users';
import {
  find_active_slack_connection_for_workspace,
  read_slack_bot_token,
  resolve_slack_bot_user_id,
} from '@coworker/runtime-platform';
import { composio_is_configured } from '@runtime-platform/composio/composio_client';

export async function read_onboarding_snapshot(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  const { workspace_id, user_id } = input;
  const [record, identity, slack_connection, user] = await Promise.all([
    get_onboarding_record(db, { workspace_id, user_id }),
    get_onboarding_identity(db, workspace_id),
    find_active_slack_connection_for_workspace(db, workspace_id),
    get_user(db, user_id),
  ]);

  const slack_bot_token = read_slack_bot_token(slack_connection);
  const slack_bot_user_id = slack_bot_token
    ? await resolve_slack_bot_user_id(slack_bot_token)
    : null;

  return {
    completed: record.completed,
    step: record.step,
    channels_joined: record.channels_joined,
    profile: record.profile,
    agent_name: identity.agent_name,
    workspace_name: identity.workspace_name,
    email_domain: work_email_domain(user?.email),
    company_scan: record.company_scan,
    slack: {
      connected: Boolean(slack_connection),
      team_name: slack_connection?.external_account_name ?? null,
      team_id: slack_connection?.external_account_id ?? null,
      bot_user_id: slack_bot_user_id,
    },
    install: read_what_this_install_has_set_up(),
  };
}

export function read_what_this_install_has_set_up() {
  return {
    slack_app_configured: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
    app_provider_configured: composio_is_configured(),
    saved_credentials_reach_the_sandbox: env.COWORKER_WORKSPACE_RUNTIME_PROVIDER === 'e2b',
    sandbox_shows_a_live_browser: env.COWORKER_WORKSPACE_RUNTIME_PROVIDER === 'e2b',
    jobs_that_need_no_app: onboarding_jobs_that_need_no_app,
  };
}
