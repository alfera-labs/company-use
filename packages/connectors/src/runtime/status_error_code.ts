import type { ConnectorErrorCode } from '@connectors/types';

function is_rate_limit_refusal(headers: Headers, detail: string) {
  return (
    Boolean(headers.get('Retry-After')) ||
    headers.get('x-ratelimit-remaining') === '0' ||
    /rate limit/iu.test(detail)
  );
}

export function status_error_code(response: Response, detail: string): ConnectorErrorCode {
  if (response.status === 429) return 'rate_limited';
  if (response.status === 403 && is_rate_limit_refusal(response.headers, detail)) {
    return 'rate_limited';
  }
  if (response.status === 401 || response.status === 403) return 'unauthorized';
  return 'provider_error';
}
