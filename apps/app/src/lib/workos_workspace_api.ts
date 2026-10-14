import { read_api_origin } from '@coworker/config/api_origin';
import {
  resolve_workspace_proxy_secret,
  set_workspace_proxy_identity_headers,
  type WorkspaceProxyUser,
  workspace_proxy_headers,
} from '@/lib/workspace_proxy_headers';

const api_origin = read_api_origin();

type WorkosUser = WorkspaceProxyUser;

type WorkosSession = { user: WorkosUser; organizationId?: string | undefined };

export async function provision_workos_workspace(
  session: WorkosSession,
): Promise<{ organizationId: string; organizationName?: string }> {
  const data = await post_workspace_api('/v1/auth/workspace', {
    ...identity_body(session.user),
    ...(session.organizationId ? { organization_id: session.organizationId } : {}),
  });
  return {
    organizationId: data.organization_id,
    ...(data.organization_name ? { organizationName: data.organization_name } : {}),
  };
}

export type WorkspaceInvitation = {
  invitation_id: string;
  organization_id: string;
  organization_name: string;
  accept_url: string;
};

export async function get_workspace_invitations_to_offer(
  user: WorkosUser,
): Promise<WorkspaceInvitation[]> {
  const payload = await call_workspace_api<{ invitations?: WorkspaceInvitation[] }>(
    '/v1/auth/workspace-invitations',
    { method: 'GET', user },
  );
  return payload?.invitations ?? [];
}

export async function create_personal_workos_workspace(
  user: WorkosUser,
): Promise<{ organizationId: string }> {
  const payload = await call_workspace_api<{ organization_id?: string }>(
    '/v1/auth/workspace/personal',
    { method: 'POST', user, body: identity_body(user) },
  );
  return { organizationId: payload?.organization_id ?? '' };
}

export async function create_workos_workspace(input: {
  user: WorkosUser;
  name: string;
}): Promise<{ organizationId: string }> {
  const data = await post_workspace_api('/v1/auth/workspace/create', {
    ...identity_body(input.user),
    name: input.name,
  });
  return { organizationId: data.organization_id };
}

export async function set_active_workspace(input: {
  providerUserId: string;
  organizationId: string;
}): Promise<void> {
  await post_workspace_api('/v1/auth/active-organization', {
    provider_user_id: input.providerUserId,
    organization_id: input.organizationId,
  });
}

function identity_body(user: WorkosUser) {
  const first_name = clean_text(user.firstName);
  const last_name = clean_text(user.lastName);
  return {
    provider_key: 'workos',
    provider_user_id: user.id,
    ...(user.email ? { email: user.email } : {}),
    ...(first_name ? { first_name } : {}),
    ...(last_name ? { last_name } : {}),
    ...(user.profilePictureUrl ? { avatar_url: user.profilePictureUrl } : {}),
    user_data: {
      provider: 'workos',
      provider_user_id: user.id,
      ...(user.profilePictureUrl ? { profile_picture_url: user.profilePictureUrl } : {}),
    },
    workspace_data: { provider: 'workos' },
  };
}

async function post_workspace_api(
  path: string,
  body: Record<string, unknown>,
): Promise<{ organization_id: string; organization_name?: string }> {
  const payload = await call_workspace_api<{
    organization_id?: string;
    organization_name?: string;
  }>(path, { method: 'POST', body });
  return {
    organization_id: payload?.organization_id ?? '',
    ...(payload?.organization_name ? { organization_name: payload.organization_name } : {}),
  };
}

async function call_workspace_api<Payload>(
  path: string,
  request: { method: 'GET' | 'POST'; user?: WorkosUser; body?: Record<string, unknown> },
): Promise<Payload | undefined> {
  const headers = new Headers({
    [workspace_proxy_headers.secret]: resolve_workspace_proxy_secret(),
  });
  if (request.user) set_workspace_proxy_identity_headers(headers, request.user);
  if (request.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${api_origin}${path}`, {
    method: request.method,
    headers,
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`Workspace API ${path} failed with ${response.status}`);
  }
  const payload = (await response.json()) as { data?: Payload };
  return payload.data;
}

function clean_text(value: string | null | undefined) {
  return value?.trim() || undefined;
}
