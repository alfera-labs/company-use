import { parse_app_config } from '@coworker/core/credentials/app_credential_config';
import type { Database } from '@coworker/core/db/connection';
import {
  type AppAwaitingCredentials,
  find_app_setup_by_connection,
  save_credentials_for_setup,
} from '@coworker/core/db/queries/discovered_apps';
import { start_connection_resume } from '@runtime-platform/connections/connection_resume_activation';
import {
  type CredentialExchangeReport,
  exchange_credential_for_connection,
} from '@runtime-platform/connections/credential_exchange_service';

export type AppSignInForm = {
  app_display_name: string;
  website_host: string;
  logo_url: string | null;
  sign_in_name_label: string;
  could_not_determine: string[];
};

export async function find_app_sign_in_form(input: {
  db: Database;
  workspace_id: string;
  connection_id: string;
}): Promise<AppSignInForm | null> {
  const setup = await find_app_setup_by_connection(input.db, input);
  if (!setup) return null;
  return {
    app_display_name: setup.app_display_name,
    website_host: setup.allowed_hosts[0] ?? '',
    logo_url: setup.logo_url,
    sign_in_name_label: setup.sign_in_name_label,
    could_not_determine: setup.could_not_determine,
  };
}

export type CompleteAppSignInResult =
  | { connected: true; delivers_headers: string[] }
  | { connected: false; message: string; retry_allowed_after_time?: string | undefined };

export async function complete_app_sign_in(input: {
  db: Database;
  workspace_id: string;
  connection_id: string;
  actor_id: string;
  sign_in_name: string;
  password: string;
}): Promise<CompleteAppSignInResult> {
  const setup = await find_app_setup_by_connection(input.db, input);
  if (!setup) throw new Error('connection_not_found');
  if (!parse_app_config(setup.app_config).exchange_the_credential_by) {
    throw new Error('credential_exchange_not_configured');
  }

  await save_credentials_for_setup(input.db, {
    connection_id: input.connection_id,
    actor_id: input.actor_id,
    values: { username: input.sign_in_name, password: input.password },
  });

  const report = await exchange_credential_for_connection({
    db: input.db,
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
  });

  if (report.exchanged) {
    await start_connection_resume(input.db, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      actor_id: input.actor_id,
      setup_state: setup.setup_state,
    });
  }
  return describe_result(report);
}

function describe_result(report: CredentialExchangeReport): CompleteAppSignInResult {
  if (report.exchanged) return { connected: true, delivers_headers: report.delivers_headers };
  return {
    connected: false,
    message: report.message,
    ...(report.retry_allowed_after_time
      ? { retry_allowed_after_time: report.retry_allowed_after_time }
      : {}),
  };
}

export type { AppAwaitingCredentials };
