// Who a Composio connected account belongs to. Composio's own record carries no identity: `alias`
// is empty unless someone typed one and `word_id` is a random memorable id (`gmail_topsy-sejoin`).
// Every toolkit does publish a `get_current_user_endpoint` (Gmail's profile, Slack's auth.test,
// GitHub's /user), and Composio's proxy calls it with the account's own token. The whole answer is
// kept as rich metadata; the display name is the first identifying field found in it.

import type { ComposioConnectedAccount } from '@coworker/core/integrations/composio_api_records';
import { create_logger, format_error_message } from '@coworker/shared';
import type { ComposioClient } from '@runtime-platform/composio/composio_client';

const log = create_logger('composio_account_identity');

export type ComposioAccountIdentity = {
  endpoint: string;
  data: unknown;
  display_name: string | null;
};

const identity_display_name_keys = [
  'emailAddress',
  'email',
  'mail',
  'userPrincipalName',
  'user_principal_name',
  'login',
  'username',
  'user_name',
  'user',
  'handle',
  'displayName',
  'display_name',
  'name',
];

export async function probe_connected_account_identity(
  client: ComposioClient,
  account: ComposioConnectedAccount,
): Promise<ComposioAccountIdentity | null> {
  try {
    const toolkit = await client.get_toolkit(account.toolkit.slug);
    const endpoint = toolkit.get_current_user_endpoint?.trim();
    if (!endpoint) return null;
    const method = read_probe_method(toolkit.get_current_user_endpoint_method);
    const result = await client.proxy_execute({
      connected_account_id: account.id,
      endpoint,
      method,
    });
    if (result.status < 200 || result.status >= 300) {
      log.warn('Identity probe answered with a non-2xx status', {
        connected_account_id: account.id,
        toolkit_slug: account.toolkit.slug,
        status: result.status,
      });
      return null;
    }
    return { endpoint, data: result.data, display_name: read_identity_display_name(result.data) };
  } catch (error) {
    log.warn('Identity probe failed', {
      connected_account_id: account.id,
      toolkit_slug: account.toolkit.slug,
      error: format_error_message(error),
    });
    return null;
  }
}

function read_probe_method(value: string | null | undefined): 'GET' | 'POST' {
  return value?.trim().toUpperCase() === 'POST' ? 'POST' : 'GET';
}

// Breadth-first by key priority: an `email` anywhere in the answer beats a `name` at the top.
// Google Drive nests it under `user`, Linear under `data.viewer`, Slack answers flat.
export function read_identity_display_name(data: unknown): string | null {
  const objects = collect_objects(data);
  for (const key of identity_display_name_keys) {
    for (const object of objects) {
      const value = object[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
  }
  return null;
}

function collect_objects(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 4 || !value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => collect_objects(item, depth + 1));
  const object = value as Record<string, unknown>;
  return [object, ...Object.values(object).flatMap((child) => collect_objects(child, depth + 1))];
}
