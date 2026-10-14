import { read_api_origin } from '@coworker/config/api_origin';
import type { OnboardingSnapshot, Workspace } from '@/lib/api/types';
import { fetch_through_tunnel, set_upstream_tunnel_headers } from '@/lib/api/upstream_tunnel';
import { read_workos_auth } from '@/lib/workos_session';
import {
  resolve_workspace_proxy_secret,
  set_workspace_proxy_identity_headers,
  workspace_proxy_headers,
} from '@/lib/workspace_proxy_headers';

const api_origin = read_api_origin();

export async function server_api_fetch(path: string, init?: RequestInit) {
  const auth = await read_workos_auth();
  const headers = new Headers(init?.headers);
  const target = `${api_origin}${path}`;

  set_upstream_tunnel_headers(headers, target);
  headers.set(workspace_proxy_headers.secret, resolve_workspace_proxy_secret());
  if (auth.user) {
    set_workspace_proxy_identity_headers(headers, auth.user, auth.organizationId);
  }

  const can_retry = !init?.body;
  return fetch_through_tunnel(target, { ...init, headers, cache: 'no-store' }, { can_retry });
}

export async function get_onboarding_snapshot_on_server(): Promise<OnboardingSnapshot | null> {
  try {
    const response = await server_api_fetch('/v1/onboarding');
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: OnboardingSnapshot };
    return body.data ?? null;
  } catch {
    return null;
  }
}

export async function get_workspace_on_server(): Promise<Workspace | null> {
  try {
    const response = await server_api_fetch('/v1/workspace');
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: Workspace };
    return body.data ?? null;
  } catch {
    return null;
  }
}
