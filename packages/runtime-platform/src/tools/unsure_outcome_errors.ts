import type { RuntimeToolFailure } from '@coworker/shared';

const send_path = /\/send\/?$/iu;

/**
 * A POST to a path ending in /send that fails with no status, a 404, or a 5xx may still
 * have been delivered, so the failure tells the agent to check before sending again.
 */
export function find_send_outcome_unknown_error(input: {
  status: number | null;
  detail: string;
  metadata: Record<string, unknown>;
}): RuntimeToolFailure | null {
  const method = String(input.metadata.proxy_method ?? '').toUpperCase();
  const url = String(input.metadata.proxy_url ?? input.metadata.proxy_endpoint ?? '');
  if (method !== 'POST' || !send_path.test(url.split(/[?#]/u)[0] ?? '')) return null;
  if (!outcome_is_unknown(input.status)) return null;
  const status_text = input.status ? `returned ${input.status}` : 'got no answer';
  return {
    success: false,
    error: {
      code: 'send_outcome_unknown',
      message: [
        `POST ${url} ${status_text}, but a send can take effect even when the proxy reports an error: it may already have gone out.`,
        'Do not repeat it and do not rebuild it as another request.',
        'Check first whether it was delivered (for email, look in the Sent folder), and tell the person what you found.',
        `Response: ${input.detail}`,
      ].join(' '),
    },
    metadata: { ...input.metadata, upstream_status: input.status, retryable: false },
  };
}

/** A write that failed with no answer or a 5xx may still have happened, so it must not be repeated blindly. */
export function find_action_outcome_unknown_error(input: {
  status: number | null;
  action: string;
  detail: string;
  metadata: Record<string, unknown>;
}): RuntimeToolFailure | null {
  if (input.status && input.status < 500) return null;
  const status_text = input.status ? `returned ${input.status}` : 'got no answer';
  return {
    success: false,
    error: {
      code: 'action_outcome_unknown',
      message: [
        `${input.action} ${status_text}, so it may already have taken effect.`,
        'Do not repeat it: check first whether it happened (read the record back, or for email look in the Sent folder), then tell the person what you found.',
        `Response: ${input.detail}`,
      ].join(' '),
    },
    metadata: { ...input.metadata, upstream_status: input.status, retryable: false },
  };
}

function outcome_is_unknown(status: number | null) {
  return !status || status === 404 || status >= 500;
}
