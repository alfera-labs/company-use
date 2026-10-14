export const workspace_proxy_headers = {
  secret: 'x-coworker-api-secret',
  provider_key: 'x-coworker-auth-provider',
  provider_user_id: 'x-coworker-auth-user-id',
  organization_id: 'x-coworker-auth-organization-id',
  email: 'x-coworker-auth-email',
  first_name: 'x-coworker-auth-first-name',
  last_name: 'x-coworker-auth-last-name',
  avatar_url: 'x-coworker-auth-avatar-url',
  client_ip: 'x-coworker-client-ip',
} as const;

export type WorkspaceProxyUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
};

export function set_workspace_proxy_identity_headers(
  headers: Headers,
  user: WorkspaceProxyUser,
  organization_id?: string | null,
) {
  headers.set(workspace_proxy_headers.provider_key, 'workos');
  headers.set(workspace_proxy_headers.provider_user_id, user.id);
  set_present_header(headers, workspace_proxy_headers.organization_id, organization_id);
  set_present_header(headers, workspace_proxy_headers.email, user.email);
  set_present_header(headers, workspace_proxy_headers.first_name, user.firstName);
  set_present_header(headers, workspace_proxy_headers.last_name, user.lastName);
  set_present_header(headers, workspace_proxy_headers.avatar_url, user.profilePictureUrl);
}

export function resolve_workspace_proxy_secret() {
  const explicit_secret = process.env.COWORKER_API_PROXY_SECRET;
  if (explicit_secret) return explicit_secret;
  if (process.env.NODE_ENV !== 'production') return 'local-development-internal-api-secret';
  throw new Error('COWORKER_API_PROXY_SECRET is required in production');
}

function set_present_header(headers: Headers, name: string, value: string | null | undefined) {
  const text = value?.trim();
  if (text) headers.set(name, text);
}
