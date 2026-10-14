import { discard_response_body, read_capped_body } from '@connectors/runtime/file_download_body';
import type {
  FileDownloadFailure,
  FileDownloadSignals,
  FileDownloadStop,
} from '@connectors/runtime/file_download_failure';
import {
  build_download_failure,
  describe_status_failure,
  describe_thrown_failure,
} from '@connectors/runtime/file_download_failure';
import type { FileHostPolicy } from '@connectors/sync/file_host_policy';
import { is_file_url_allowed, is_protocol_downgrade } from '@connectors/sync/file_host_policy';

export type FetchConnectorFileLimits = {
  max_bytes: number;
  max_redirects: number;
  timeout_ms: number;
};

export type FileRequestSender = (url: URL, init: RequestInit) => Promise<Response>;

export type FetchConnectorFileDependencies = {
  policy: FileHostPolicy;
  limits: FetchConnectorFileLimits;
  send_request: FileRequestSender;
};

export type FetchConnectorFileInput = {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type FetchConnectorFileResult =
  | { outcome: 'ok'; bytes: Uint8Array; content_type: string | null }
  | { outcome: 'too_large' }
  | { outcome: 'host_refused' }
  | FileDownloadStop
  | FileDownloadFailure;

type FileDownload = {
  dependencies: FetchConnectorFileDependencies;
  original_url: URL;
  headers: Record<string, string> | undefined;
  signals: FileDownloadSignals;
};

type HopResult = FetchConnectorFileResult | { outcome: 'redirect'; next_url: URL };

const redirect_statuses = new Set([301, 302, 303, 307, 308]);

function parse_request_url(raw_url: string) {
  return URL.canParse(raw_url) ? new URL(raw_url) : null;
}

function build_request_init(download: FileDownload): RequestInit {
  const { caller_signal, timeout_signal } = download.signals;
  const signal = caller_signal ? AbortSignal.any([caller_signal, timeout_signal]) : timeout_signal;
  const headers = download.headers ? { headers: download.headers } : {};
  return { redirect: 'manual', signal, ...headers };
}

async function read_redirect(response: Response, current_url: URL): Promise<HopResult> {
  await discard_response_body(response);
  const location = response.headers.get('location');
  if (location && URL.canParse(location, current_url)) {
    return { outcome: 'redirect', next_url: new URL(location, current_url) };
  }
  return build_download_failure(
    'missing_redirect_location',
    `HTTP ${response.status} from ${current_url.hostname} without a usable location`,
  );
}

async function read_hop_response(
  download: FileDownload,
  response: Response,
  current_url: URL,
): Promise<HopResult> {
  if (redirect_statuses.has(response.status)) return read_redirect(response, current_url);
  if (!response.ok) {
    await discard_response_body(response);
    return describe_status_failure(response, current_url);
  }
  const body = await read_capped_body(response, download.dependencies.limits.max_bytes);
  if (body.outcome === 'too_large') return body;
  return { outcome: 'ok', bytes: body.bytes, content_type: response.headers.get('content-type') };
}

async function run_hop(download: FileDownload, current_url: URL): Promise<HopResult> {
  try {
    const response = await download.dependencies.send_request(
      current_url,
      build_request_init(download),
    );
    return await read_hop_response(download, response, current_url);
  } catch (error) {
    return describe_thrown_failure(error, download.signals, current_url);
  }
}

function is_redirect_refused(download: FileDownload, next_url: URL) {
  if (is_protocol_downgrade(download.original_url, next_url)) return true;
  return !is_file_url_allowed(download.dependencies.policy, next_url);
}

async function follow_hops(
  download: FileDownload,
  current_url: URL,
  redirects_followed: number,
): Promise<FetchConnectorFileResult> {
  const hop = await run_hop(download, current_url);
  if (hop.outcome !== 'redirect') return hop;
  if (is_redirect_refused(download, hop.next_url)) return { outcome: 'host_refused' };
  const { max_redirects } = download.dependencies.limits;
  if (redirects_followed >= max_redirects) {
    return build_download_failure('too_many_redirects', `more than ${max_redirects} redirects`);
  }
  return follow_hops(download, hop.next_url, redirects_followed + 1);
}

export async function fetch_connector_file(
  dependencies: FetchConnectorFileDependencies,
  input: FetchConnectorFileInput,
): Promise<FetchConnectorFileResult> {
  const url = parse_request_url(input.url);
  if (!url) return build_download_failure('invalid_url', 'the download url does not parse');
  if (!is_file_url_allowed(dependencies.policy, url)) return { outcome: 'host_refused' };
  if (input.signal?.aborted) return { outcome: 'aborted' };
  const signals: FileDownloadSignals = {
    caller_signal: input.signal ?? null,
    timeout_signal: AbortSignal.timeout(dependencies.limits.timeout_ms),
  };
  const download = { dependencies, original_url: url, headers: input.headers, signals };
  return follow_hops(download, url, 0);
}
