import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type { ConnectorErrorCode } from '@connectors/types';

type SlackFailure = {
  code: ConnectorErrorCode;
  retryable: boolean;
};

const slack_error_outcomes: Record<string, SlackFailure> = {
  invalid_auth: { code: 'unauthorized', retryable: false },
  not_authed: { code: 'unauthorized', retryable: false },
  account_inactive: { code: 'unauthorized', retryable: false },
  token_revoked: { code: 'unauthorized', retryable: false },
  token_expired: { code: 'unauthorized', retryable: false },
  missing_scope: { code: 'unauthorized', retryable: false },
  not_allowed_token_type: { code: 'unauthorized', retryable: false },
  no_permission: { code: 'unauthorized', retryable: false },
  ekm_access_denied: { code: 'unauthorized', retryable: false },
  ratelimited: { code: 'rate_limited', retryable: true },
  rate_limited: { code: 'rate_limited', retryable: true },
  fatal_error: { code: 'provider_error', retryable: true },
  internal_error: { code: 'provider_error', retryable: true },
  service_unavailable: { code: 'provider_error', retryable: true },
  request_timeout: { code: 'provider_error', retryable: true },
};

const unlisted_slack_failure: SlackFailure = { code: 'provider_error', retryable: false };

export type SlackEnvelope = {
  ok: boolean;
  error?: string;
  warning?: string;
};

export function throw_on_slack_error(response: SlackEnvelope, method: string) {
  if (response.ok) return;
  const slack_error = response.error ?? 'unknown_error';
  const failure = slack_error_outcomes[slack_error] ?? unlisted_slack_failure;
  throw new ConnectorHttpError(
    failure.code,
    `Slack ${method} answered ok=false: ${slack_error}`,
    200,
    failure.retryable,
  );
}

export function find_next_cursor(response_metadata?: { next_cursor?: string }) {
  const cursor = response_metadata?.next_cursor;
  return cursor ? cursor : null;
}
