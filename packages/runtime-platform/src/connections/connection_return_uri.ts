import { env } from '@coworker/config';
import { normalize_origin } from '@coworker/config/env_value_schemas';
import type { ConnectionSetupStateData } from '@coworker/core/db/schema/json_column_types';
import { ValidationError } from '@coworker/shared';

export function build_connection_return_uri(
  redirect_uri: string,
  setup_state: ConnectionSetupStateData,
) {
  const url = new URL(redirect_uri);
  if (!allowed_return_origins().has(normalize_origin(url.origin))) {
    throw new ValidationError('redirect_uri must be on an allowed origin', {
      origin: url.origin,
    });
  }
  const connection_id = setup_state.connection_id?.trim();
  const provider_key = setup_state.provider_key?.trim();
  const setup_token = setup_state.setup_token?.trim();

  if (connection_id) url.searchParams.set('connection_id', connection_id);
  if (provider_key) url.searchParams.set('provider_key', provider_key);
  if (setup_token) url.searchParams.set('setup_token', setup_token);

  return url.toString();
}

export function allowed_return_origins() {
  return new Set(env.ALLOWED_ORIGINS.split(',').map(normalize_origin).filter(Boolean));
}
