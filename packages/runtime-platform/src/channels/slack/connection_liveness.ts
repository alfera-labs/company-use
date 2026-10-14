import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import type {
  ExclusiveClaimIncumbent,
  IncumbentLiveness,
} from '@runtime-platform/channels/exclusive_external_account_claims';
import { ErrorCode, type WebAPICallError, WebClient } from '@slack/web-api';

const dead_slack_auth_error_codes = new Set([
  'token_revoked',
  'token_expired',
  'account_inactive',
  'invalid_auth',
  'not_authed',
  'no_permission',
]);

export async function probe_slack_connection_liveness(
  incumbent: ExclusiveClaimIncumbent,
): Promise<IncumbentLiveness> {
  const token =
    read_connection_credential_value(incumbent.credentials, 'bot_token') ??
    read_connection_credential_value(incumbent.credentials, 'access_token');
  if (!token) return 'dead';

  try {
    const response = await new WebClient(token).auth.test();
    return response.ok ? 'alive' : 'unknown';
  } catch (error) {
    return is_dead_slack_token_error(error) ? 'dead' : 'unknown';
  }
}

function is_dead_slack_token_error(error: unknown): boolean {
  const slack_error = error as WebAPICallError;
  return (
    slack_error?.code === ErrorCode.PlatformError &&
    typeof slack_error.data?.error === 'string' &&
    dead_slack_auth_error_codes.has(slack_error.data.error)
  );
}
