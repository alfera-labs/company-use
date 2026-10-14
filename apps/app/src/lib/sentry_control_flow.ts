import { isNotFound, isRedirect } from '@tanstack/react-router';
import { ClientDisconnected } from '@/lib/client_disconnect';
import { scrub_sign_in_links_in_report } from '@/lib/sign_in_link_scrub';

// TanStack Start signals control flow by throwing: `redirect()` throws a Response, `notFound()`
// throws a marker object, and a dropped request throws the abort reason. Sentry's request and
// function middlewares capture every throw they see, so without this filter a gate redirect or a
// closed tab would report as an unhandled error.
//
// `isRedirect` already knows a TanStack redirect by the `.options` it carries. A bare
// `new Response(...)` thrown by app code is not control flow, it is a bug, and it stays visible.
export function is_control_flow_throw(thrown: unknown): boolean {
  if (thrown instanceof ClientDisconnected) return true;
  return isRedirect(thrown) || isNotFound(thrown);
}

export type SentryEventWithRequestHeaders = {
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
  };
};

export function drop_control_flow_throws_and_scrub_secrets<T extends SentryEventWithRequestHeaders>(
  event: T,
  hint: { originalException?: unknown },
): T | null {
  if (is_control_flow_throw(hint.originalException)) return null;
  remove_secret_headers(event.request?.headers);
  remove_query_string(event.request);
  return scrub_sign_in_links_in_report(event);
}

const secret_header_names = new Set(['authorization', 'cookie', 'x-coworker-api-secret']);

function remove_secret_headers(headers: Record<string, unknown> | undefined) {
  if (!headers) return;

  for (const key of Object.keys(headers)) {
    if (secret_header_names.has(key.toLowerCase())) delete headers[key];
  }
}

function remove_query_string(request: SentryEventWithRequestHeaders['request']) {
  if (!request) return;
  if (typeof request.url === 'string') request.url = request.url.split('?')[0] ?? request.url;
  delete request.query_string;
  delete request.cookies;
}
