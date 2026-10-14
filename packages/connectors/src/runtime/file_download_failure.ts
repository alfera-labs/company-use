import { status_error_code } from '@connectors/runtime/status_error_code';
import type { ConnectorErrorCode } from '@connectors/types';
import { parse_retry_after } from '@coworker/shared';

export type FileDownloadFailureReason =
  | Extract<
      ConnectorErrorCode,
      'unauthorized' | 'rate_limited' | 'provider_error' | 'network_error'
    >
  | 'invalid_url'
  | 'missing_redirect_location'
  | 'too_many_redirects';

export type FileDownloadFailure = {
  outcome: 'download_failed';
  reason: FileDownloadFailureReason;
  status: number | null;
  retry_after_ms: number | null;
  detail: string;
};

export type FileDownloadStop = { outcome: 'timed_out' } | { outcome: 'aborted' };

export type FileDownloadSignals = {
  caller_signal: AbortSignal | null;
  timeout_signal: AbortSignal;
};

const safe_error_code_pattern = /^[A-Za-z0-9_]{1,64}$/u;

export function build_download_failure(
  reason: FileDownloadFailureReason,
  detail: string,
): FileDownloadFailure {
  return { outcome: 'download_failed', reason, status: null, retry_after_ms: null, detail };
}

export function describe_status_failure(response: Response, url: URL): FileDownloadFailure {
  const reason = status_error_code(response, '');
  return {
    outcome: 'download_failed',
    reason: reason === 'unauthorized' || reason === 'rate_limited' ? reason : 'provider_error',
    status: response.status,
    retry_after_ms:
      reason === 'rate_limited' ? parse_retry_after(response.headers.get('retry-after')) : null,
    detail: `HTTP ${response.status} from ${url.hostname}`,
  };
}

function read_safe_error_code(error: unknown) {
  if (!(error instanceof Error)) return 'unknown_error';
  const code = 'code' in error ? error.code : null;
  if (typeof code === 'string' && safe_error_code_pattern.test(code)) return code;
  return safe_error_code_pattern.test(error.name) ? error.name : 'unknown_error';
}

export function describe_thrown_failure(
  error: unknown,
  signals: FileDownloadSignals,
  url: URL,
): FileDownloadFailure | FileDownloadStop {
  if (signals.caller_signal?.aborted) return { outcome: 'aborted' };
  if (signals.timeout_signal.aborted) return { outcome: 'timed_out' };
  return build_download_failure(
    'network_error',
    `${read_safe_error_code(error)} from ${url.hostname}`,
  );
}
