import {
  check_pasted_model_key,
  describe_model_provider,
  finish_chatgpt_sign_in,
  start_chatgpt_sign_in,
} from '@api/services/models/ai_connections';
import {
  list_models,
  read_workspace_model_catalog_environment,
} from '@api/services/models/model_catalog';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  find_model_provider_account_row,
  save_model_provider_account_row,
} from '@coworker/core/db/queries/model_provider_account_rows';
import {
  type ModelProviderAccount,
  upsert_model_provider_account,
} from '@coworker/core/db/queries/model_provider_accounts';
import { read_connection_credential_values } from '@coworker/core/integrations/credential_envelope';
import type { ModelProviderAccountSlot } from '@coworker/core/integrations/model_provider_account_slots';
import { chatgpt_plan_value_names } from '@coworker/runtime-platform';
import { AppError } from '@coworker/shared';

type WorkspaceActor = { db: Database; workspace_id: string; actor_id: string };

export async function connect_workspace_model_key(
  actor: WorkspaceActor,
  input: { api_key: string; provider_slot?: string | undefined },
) {
  const checked = await check_pasted_model_key(input);
  const account = await upsert_model_provider_account(actor.db, {
    workspace_id: actor.workspace_id,
    provider_slot: checked.provider_slot,
    api_key: input.api_key.trim(),
    actor_id: actor.actor_id,
  });
  return describe_connection(actor, checked.provider_slot, account);
}

export async function start_workspace_chatgpt_sign_in(actor: WorkspaceActor) {
  require_self_hosted_install();
  const saved = await read_saved_chatgpt_sign_in(actor);
  return start_chatgpt_sign_in({
    bound_to: actor.workspace_id,
    ...(saved.client_id ? { saved_client_id: saved.client_id } : {}),
    ...(saved.client_id && saved.id_token ? { id_token_hint: saved.id_token } : {}),
  });
}

export async function finish_workspace_chatgpt_sign_in(
  actor: WorkspaceActor,
  input: { sign_in_attempt: string; callback_url: string },
) {
  require_self_hosted_install();
  const result = await finish_chatgpt_sign_in({ ...input, bound_to: actor.workspace_id });
  const now = new Date();
  const metadata = {
    secret_hint: result.values[chatgpt_plan_value_names.client_id]?.slice(-4) ?? '',
    account_label: result.account.email,
    error_message: null,
  };
  await save_model_provider_account_row(actor.db, {
    workspace_id: actor.workspace_id,
    provider_slot: result.provider_slot,
    values: result.values,
    metadata,
    actor_id: actor.actor_id,
    now,
  });
  return describe_connection(actor, result.provider_slot, {
    provider_slot: result.provider_slot,
    display_name: result.display_name,
    secret_hint: metadata.secret_hint,
    credential_status: 'active',
    last_validated_time: now,
    error_message: null,
  });
}

async function describe_connection(
  actor: WorkspaceActor,
  provider_slot: ModelProviderAccountSlot,
  account: ModelProviderAccount,
) {
  const environment = await read_workspace_model_catalog_environment(actor.db, actor.workspace_id);
  return {
    provider: describe_model_provider(provider_slot),
    account,
    models: await list_models(environment),
  };
}

async function read_saved_chatgpt_sign_in(actor: WorkspaceActor) {
  const row = await find_model_provider_account_row(actor.db, {
    workspace_id: actor.workspace_id,
    provider_slot: 'chatgpt_plan',
  });
  const values = read_connection_credential_values(row?.credentials);
  return {
    client_id: values[chatgpt_plan_value_names.client_id],
    id_token: values[chatgpt_plan_value_names.id_token],
  };
}

function require_self_hosted_install() {
  if (env.COWORKER_SELF_HOSTED) return;
  throw new AppError(
    'chatgpt_plan_not_offered_here',
    'Signing in with a ChatGPT plan works on a self-hosted Alfera only.',
    404,
  );
}
