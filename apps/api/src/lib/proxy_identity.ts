import { timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from '@api/lib/context';
import { env } from '@coworker/config';
import type { WorkspaceIdentity } from '@coworker/core/db/queries/workspace_identity';
import { AppError } from '@coworker/shared';
import type { Context } from 'hono';
import { z } from 'zod';

/** Accepted outside production when no secret is set. It is public source, so it protects nothing. */
export const development_proxy_secret = 'local-development-internal-api-secret';

export const proxy_auth_headers = {
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

export const workspace_identity_schema = z.object({
  provider_key: z.string().min(1).max(80),
  provider_user_id: z.string().min(1).max(200),
  organization_id: z.string().min(1).max(200).optional(),
  organization_name: z.string().min(1).max(240).optional(),
  membership_id: z.string().min(1).max(200).optional(),
  member_role: z.string().min(1).max(80).optional(),
  member_status: z.string().min(1).max(80).optional(),
  email: z.email().optional(),
  first_name: z.string().min(1).max(120).optional(),
  last_name: z.string().min(1).max(120).optional(),
  avatar_url: z.url().optional(),
  user_data: z.record(z.string(), z.unknown()).optional(),
  workspace_data: z.record(z.string(), z.unknown()).optional(),
});

export type ProxyWorkspaceIdentity = z.infer<typeof workspace_identity_schema>;

export const active_organization_schema = z.object({
  provider_user_id: z.string().min(1).max(200),
  organization_id: z.string().min(1).max(200),
});

export const create_workspace_schema = workspace_identity_schema.extend({
  name: z.string().trim().min(1).max(120),
});

export function verify_proxy_secret(c: Context<ApiEnv>) {
  const expected_secret = resolve_proxy_secret();
  const actual_secret = c.req.header(proxy_auth_headers.secret);

  if (!expected_secret) {
    throw new AppError('configuration_error', 'API proxy secret is not configured', 500);
  }

  if (!actual_secret || !secrets_match(actual_secret, expected_secret)) {
    throw new AppError('unauthorized', 'Missing API proxy authorization', 401);
  }
}

export function carries_the_proxy_secret(c: Context<ApiEnv>): boolean {
  const expected_secret = resolve_proxy_secret();
  const actual_secret = c.req.header(proxy_auth_headers.secret);
  return Boolean(expected_secret && actual_secret && secrets_match(actual_secret, expected_secret));
}

export function verify_machine_caller(c: Context<ApiEnv>) {
  verify_proxy_secret(c);
  reject_user_caller(c);
}

function secrets_match(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function reject_user_caller(c: Context<ApiEnv>) {
  if (c.req.header(proxy_auth_headers.provider_user_id)) {
    throw new AppError('forbidden', 'This route is not reachable as a user', 403);
  }
}

export function read_proxy_identity(c: Context<ApiEnv>): WorkspaceIdentity | null {
  const provider_key = read_header(c, proxy_auth_headers.provider_key);
  const provider_user_id = read_header(c, proxy_auth_headers.provider_user_id);
  if (!provider_key || !provider_user_id) return null;

  return clean_workspace_identity(
    workspace_identity_schema.parse({
      provider_key,
      provider_user_id,
      organization_id: read_header(c, proxy_auth_headers.organization_id),
      email: read_header(c, proxy_auth_headers.email),
      first_name: read_header(c, proxy_auth_headers.first_name),
      last_name: read_header(c, proxy_auth_headers.last_name),
      avatar_url: read_header(c, proxy_auth_headers.avatar_url),
    }),
  );
}

export function require_proxy_identity(c: Context<ApiEnv>): WorkspaceIdentity {
  verify_proxy_secret(c);
  const identity = read_proxy_identity(c);
  if (!identity) {
    throw new AppError('unauthorized', 'Signed-in user identity is required', 401);
  }
  return identity;
}

export function require_proxy_identity_with_body(
  c: Context<ApiEnv>,
  body_identity: ProxyWorkspaceIdentity,
): WorkspaceIdentity {
  const proxy_identity = require_proxy_identity(c);
  const body = clean_workspace_identity(body_identity);
  if (
    proxy_identity.provider_key !== body.provider_key ||
    proxy_identity.provider_user_id !== body.provider_user_id
  ) {
    throw new AppError('forbidden', 'Request identity does not match the signed-in user', 403);
  }
  const picture = body.user_data?.profile_picture_url;
  return {
    ...body,
    ...proxy_identity,
    user_data: {
      provider: proxy_identity.provider_key,
      provider_user_id: proxy_identity.provider_user_id,
      ...(typeof picture === 'string' && /^https:\/\//.test(picture)
        ? { profile_picture_url: picture }
        : {}),
    },
    workspace_data: { provider: proxy_identity.provider_key },
  };
}

export function has_proxy_identity(c: Context<ApiEnv>) {
  return Boolean(
    c.req.header(proxy_auth_headers.secret) || c.req.header(proxy_auth_headers.provider_user_id),
  );
}

export function clean_workspace_identity(input: ProxyWorkspaceIdentity): WorkspaceIdentity {
  return {
    provider_key: input.provider_key,
    provider_user_id: input.provider_user_id,
    ...(input.organization_id ? { organization_id: input.organization_id } : {}),
    ...(input.organization_name ? { organization_name: input.organization_name } : {}),
    ...(input.membership_id ? { membership_id: input.membership_id } : {}),
    ...(input.member_role ? { member_role: input.member_role } : {}),
    ...(input.member_status ? { member_status: input.member_status } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.first_name ? { first_name: input.first_name } : {}),
    ...(input.last_name ? { last_name: input.last_name } : {}),
    ...(input.avatar_url ? { avatar_url: input.avatar_url } : {}),
    ...(input.user_data ? { user_data: input.user_data } : {}),
    ...(input.workspace_data ? { workspace_data: input.workspace_data } : {}),
  };
}

function resolve_proxy_secret() {
  if (env.COWORKER_API_PROXY_SECRET) return env.COWORKER_API_PROXY_SECRET;
  if (env.NODE_ENV !== 'production') return development_proxy_secret;
  return undefined;
}

function read_header(c: Context<ApiEnv>, name: string) {
  return c.req.header(name)?.trim() || undefined;
}
