import { is_api_proxy_runtime_handler } from '@coworker/core/integrations/provider_runtime_handlers';
import type { RuntimeToolFailure } from '@coworker/shared';
import type { CatalogTool } from '@runtime-platform/tools/catalog_tool_types';

const gmail_api_hosts = new Set(['gmail.googleapis.com', 'www.googleapis.com']);
const gmail_api_path_prefix = '/gmail/v1/';
const gmail_send_path = /\/(messages|drafts)\/send$/u;
const origin_for_relative_paths = 'https://relative-path.invalid';

export const gmail_send_through_api_proxy_message = [
  'Sending email through the Gmail API proxy is blocked: a send cannot be undone, and a proxy send that reports an error may already have gone out.',
  "Instead, create the reply with runtime-create_gmail_reply_draft-1, then send that draft once with the connected Gmail app's send-draft tool.",
  'If the connection has no send-draft tool, tell the person the draft is ready to send from Gmail.',
  'Never send again after an error: check the Sent folder first.',
].join(' ');

/** Refuses an API-proxy POST that would send Gmail email, so it never reaches the network. */
export function find_gmail_send_through_api_proxy_error(
  tool: CatalogTool,
  tool_input: Record<string, unknown>,
): RuntimeToolFailure | null {
  if (!is_api_proxy_runtime_handler(tool.runtime_handler)) return null;
  const proxy = tool.node_config.proxy;
  if (proxy?.method?.toUpperCase() !== 'POST') return null;
  const target = read_proxy_target(tool_input.url, proxy.base_proxy_target_url);
  if (!target || !is_gmail_send(target)) return null;
  return {
    success: false,
    error: { code: 'blocked_by_policy', message: gmail_send_through_api_proxy_message },
    metadata: {
      proxy_url: target.href,
      required_tool: 'runtime-create_gmail_reply_draft-1',
      retryable: false,
    },
  };
}

function read_proxy_target(url: unknown, base_url: string | null | undefined) {
  if (typeof url !== 'string') return null;
  const base = base_url && URL.canParse(base_url) ? base_url : origin_for_relative_paths;
  return URL.canParse(url.trim(), base) ? new URL(url.trim(), base) : null;
}

function is_gmail_send(target: URL) {
  const path = decode_path(target.pathname).toLowerCase().replace(/\/+$/u, '');
  const is_gmail_api = gmail_api_hosts.has(target.hostname) || path.includes(gmail_api_path_prefix);
  return is_gmail_api && gmail_send_path.test(path);
}

function decode_path(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
