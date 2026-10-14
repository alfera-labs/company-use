import type { RuntimeToolFailure } from '@coworker/shared';
import { format_error_message } from '@coworker/shared';
import { ComposioApiError } from '@runtime-platform/composio/composio_client';
import { message_names_rate_limit } from '@runtime-platform/composio/sync/provider_rate_limit';
import {
  find_action_outcome_unknown_error,
  find_send_outcome_unknown_error,
} from '@runtime-platform/tools/unsure_outcome_errors';

export type ComposioCallKind = 'action' | 'proxy';

/** Maps a Composio failure to a tool failure; a write that may have happened is never retryable. */
export function map_composio_error(
  error: unknown,
  input: {
    call_kind: ComposioCallKind;
    metadata: Record<string, unknown>;
    repeats_are_safe: boolean;
  },
): RuntimeToolFailure {
  const unsure = { status: read_composio_status(error), detail: format_error_message(error) };
  const unsure_error =
    find_send_outcome_unknown_error({ ...unsure, metadata: input.metadata }) ??
    (input.repeats_are_safe
      ? null
      : find_action_outcome_unknown_error({
          ...unsure,
          action: describe_call(input),
          metadata: input.metadata,
        }));
  if (unsure_error) return unsure_error;
  if (!(error instanceof ComposioApiError)) {
    return tool_error('provider_unreachable', format_error_message(error), {
      ...input.metadata,
      retryable: true,
    });
  }
  return map_composio_api_error(error, input);
}

function read_composio_status(error: unknown) {
  return error instanceof ComposioApiError ? error.status : null;
}

function describe_call(input: { call_kind: ComposioCallKind; metadata: Record<string, unknown> }) {
  const { metadata } = input;
  return input.call_kind === 'proxy'
    ? `${String(metadata.proxy_method ?? 'POST')} ${String(metadata.proxy_endpoint ?? '')}`
    : `The ${String(metadata.provider_component_id ?? 'Composio')} action`;
}

function map_composio_api_error(
  error: ComposioApiError,
  input: { call_kind: ComposioCallKind; metadata: Record<string, unknown> },
): RuntimeToolFailure {
  const metadata = {
    ...input.metadata,
    composio_status: error.status,
    ...(error.request_id ? { request_id: error.request_id } : {}),
  };
  const message = compose_error_message(error);

  if (error.status === 403 && message_names_rate_limit(message)) {
    return tool_error('rate_limited', `Composio rate limit: ${message}`, {
      ...metadata,
      retryable: true,
    });
  }
  if (error.status === 401 || error.status === 403) {
    return tool_error('credential_expired', message, { ...metadata, retryable: false });
  }
  if (error.status === 404) {
    return input.call_kind === 'proxy'
      ? tool_error('upstream_not_found', message, {
          ...metadata,
          upstream_status: 404,
          retryable: false,
        })
      : tool_error('invalid_tool', `Composio tool was not found: ${message}`, {
          ...metadata,
          retryable: false,
        });
  }
  if (error.status === 429) {
    return tool_error('rate_limited', `Composio rate limit: ${message}`, {
      ...metadata,
      retryable: true,
    });
  }
  if (error.status >= 500) {
    return tool_error('provider_unreachable', `Composio server error (${error.status}).`, {
      ...metadata,
      retryable: true,
    });
  }
  return tool_error('composio_error', message, { ...metadata, retryable: false });
}

function compose_error_message(error: { message: string; suggested_fix?: string }) {
  const suggested_fix = error.suggested_fix?.trim();
  return suggested_fix ? `${error.message} ${suggested_fix}` : error.message;
}

function tool_error(
  code: string,
  message: string,
  metadata: Record<string, unknown>,
): RuntimeToolFailure {
  return { success: false, error: { code, message }, metadata };
}
