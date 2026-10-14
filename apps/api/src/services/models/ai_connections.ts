import { list_models } from '@api/services/models/model_catalog';
import { model_provider_logo_url } from '@api/services/models/model_catalog_entry';
import { deployment_model_environment } from '@api/services/models/model_catalog_environment';
import {
  type ModelProviderAccountSlot,
  model_provider_account_slots,
} from '@coworker/core/integrations/model_provider_account_slots';
import { require_model_proxy } from '@coworker/shared';

export {
  type ChatgptSignInResult,
  type ChatgptSignInStart,
  finish_chatgpt_sign_in,
  start_chatgpt_sign_in,
} from '@api/services/models/chatgpt_sign_in';
export {
  type CheckedModelKey,
  check_pasted_model_key,
} from '@api/services/models/check_pasted_model_key';
export { refresh_chatgpt_sign_in } from '@coworker/runtime-platform';

export function list_models_for_connections(values_by_env_name: Record<string, string>) {
  const install = deployment_model_environment().environment;
  return list_models({ environment: { ...install, ...values_by_env_name } });
}

export function describe_model_provider(provider_slot: ModelProviderAccountSlot) {
  const slot = model_provider_account_slots[provider_slot];
  const proxy = require_model_proxy(slot.model_proxy);
  return {
    provider_slot,
    display_name: slot.display_name,
    logo_url: model_provider_logo_url(proxy.models_dev_provider_name),
  };
}
