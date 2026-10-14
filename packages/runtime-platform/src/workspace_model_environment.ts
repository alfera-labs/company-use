import type { LlmEnvironment } from '@agent-core/llm_gateway/model_resolver';
import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { Database } from '@coworker/core/db/connection';
import { read_install_model_provider_account_values } from '@coworker/core/db/queries/install_model_provider_accounts';
import { read_model_billing_preference } from '@coworker/core/db/queries/model_billing_source';
import { read_model_provider_account_values } from '@coworker/core/db/queries/model_provider_accounts';
import { create_logger } from '@coworker/shared';
import {
  chatgpt_access_token_renewal_is_due,
  renew_chatgpt_access_token_before_it_expires,
} from '@runtime-platform/chatgpt_access_token';
import { chatgpt_plan_renewal_is_due } from '@runtime-platform/chatgpt_plan/chatgpt_plan_renewal';
import { renew_install_chatgpt_plan_before_it_expires } from '@runtime-platform/chatgpt_plan/install_chatgpt_plan_renewal';
import { renew_chatgpt_plan_access_token_before_it_expires } from '@runtime-platform/chatgpt_plan/workspace_chatgpt_plan_renewal';

const log = create_logger('workspace_model_environment');

export type WorkspaceModelEnvironment = {
  environment: LlmEnvironment;
  workspace_owned_env_names: ReadonlySet<string>;
};

export async function build_workspace_model_environment(
  db: Database,
  workspace_id: string,
  base_environment: LlmEnvironment = read_process_env(),
): Promise<WorkspaceModelEnvironment> {
  const [preference, renewals_due, install_renewal] = await Promise.allSettled([
    read_model_billing_preference(db, workspace_id),
    find_due_token_renewals(db, workspace_id),
    renew_install_values(db),
  ]);
  if (read_settled(preference) === 'credits') return credits_environment(base_environment);
  if (install_renewal.status === 'rejected') {
    log.warn(
      'could not renew the ChatGPT plan of the install; runs use the stored values',
      install_renewal.reason,
    );
  }
  await Promise.all(read_settled(renewals_due).map((renewal) => renewal.renew(db, workspace_id)));
  const [install_values, workspace_values] = await Promise.all([
    read_install_values(db),
    read_model_provider_account_values(db, workspace_id),
  ]);
  return lay_stored_keys_over_env_later_layers_winning(base_environment, [
    install_values,
    workspace_values,
  ]);
}

const token_renewals = [
  {
    is_due: chatgpt_access_token_renewal_is_due,
    renew: renew_chatgpt_access_token_before_it_expires,
  },
  {
    is_due: chatgpt_plan_renewal_is_due,
    renew: renew_chatgpt_plan_access_token_before_it_expires,
  },
];

async function find_due_token_renewals(db: Database, workspace_id: string) {
  const due = await Promise.all(token_renewals.map((renewal) => renewal.is_due(db, workspace_id)));
  return token_renewals.filter((_renewal, index) => due[index]);
}

export async function read_workspace_model_environment(
  db: Database,
  workspace_id: string,
  base_environment: LlmEnvironment = read_process_env(),
): Promise<WorkspaceModelEnvironment> {
  const [preference, install_values, workspace_values] = await Promise.allSettled([
    read_model_billing_preference(db, workspace_id),
    read_install_values(db),
    read_model_provider_account_values(db, workspace_id),
  ]);
  if (read_settled(preference) === 'credits') return credits_environment(base_environment);
  return lay_stored_keys_over_env_later_layers_winning(base_environment, [
    read_settled(install_values),
    read_settled(workspace_values),
  ]);
}

async function read_install_values(db: Database): Promise<Record<string, string>> {
  return is_team_mode_switched_on() ? read_install_model_provider_account_values(db) : {};
}

async function renew_install_values(db: Database): Promise<void> {
  if (is_team_mode_switched_on()) await renew_install_chatgpt_plan_before_it_expires(db);
}

function read_settled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

function credits_environment(base_environment: LlmEnvironment): WorkspaceModelEnvironment {
  return { environment: base_environment, workspace_owned_env_names: new Set() };
}

function lay_stored_keys_over_env_later_layers_winning(
  base_environment: LlmEnvironment,
  layers: readonly Record<string, string>[],
): WorkspaceModelEnvironment {
  const owned_values = Object.assign({}, ...layers) as Record<string, string>;
  return {
    environment: { ...base_environment, ...owned_values },
    workspace_owned_env_names: new Set(Object.keys(owned_values)),
  };
}

function read_process_env(): LlmEnvironment {
  const maybe_process = (globalThis as { process?: { env?: LlmEnvironment } }).process;
  return maybe_process?.env ?? {};
}
