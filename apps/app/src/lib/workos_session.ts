import { redirect } from '@tanstack/react-router';
import { getRequest } from '@tanstack/react-start/server';
import {
  AuthenticateWithSessionCookieFailureReason,
  type Impersonator,
  type User,
  WorkOS,
} from '@workos-inc/node';

export const session_cookie_name = 'wos-session';
const session_cookie_max_age_seconds = 60 * 60 * 24 * 400;

export type WorkosUser = User;

export type WorkosAuth = {
  user: User | null;
  organizationId?: string;
  impersonator?: Impersonator;
  accessToken?: string;
  sessionId?: string;
  permissions?: string[];
};

export type SessionAuthentication = {
  auth: WorkosAuth;
  rotated_session_set_cookie?: string;
  // The rotated sealed session itself. Anything later in the same request that re-mints the
  // session (the organization pin, sign-out's logout URL) must use THIS value, not the request
  // cookie: the old cookie's refresh token was just spent, and WorkOS refuses to spend it twice.
  rotated_sealed_session?: string;
  expired_session_set_cookie?: string;
};

const signed_out: WorkosAuth = { user: null };

let workos_client: WorkOS | undefined;

export function get_workos(): WorkOS {
  workos_client ??= new WorkOS(required_env('WORKOS_API_KEY'), {
    clientId: workos_client_id(),
  });
  return workos_client;
}

export function workos_client_id(): string {
  return required_env('WORKOS_CLIENT_ID');
}

function workos_cookie_password(): string {
  return required_env('WORKOS_COOKIE_PASSWORD');
}

function required_env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function seal_session_option() {
  return { sealSession: true, cookiePassword: workos_cookie_password() };
}

export async function authenticate_session_cookie(
  sealed: string | undefined,
): Promise<SessionAuthentication> {
  if (!sealed) return { auth: signed_out };

  const session = get_workos().userManagement.loadSealedSession({
    sessionData: sealed,
    cookiePassword: workos_cookie_password(),
  });

  // The SDK reports expired/malformed tokens as `invalid_jwt` but THROWS on verification
  // failures outside that shape — e.g. `ERR_JWKS_NO_MATCHING_KEY` when the access token was
  // signed by a key no longer in the environment's JWKS (signing-key rotation, or a cookie
  // sealed for another environment with the same password). Those sessions may still hold a
  // live refresh token, so they take the same refresh-or-expire path as an invalid JWT
  // instead of crashing the request.
  const result = await session.authenticate().catch(() => ({
    authenticated: false as const,
    reason: AuthenticateWithSessionCookieFailureReason.INVALID_JWT,
  }));
  if (result.authenticated) {
    return {
      auth: {
        user: result.user,
        accessToken: result.accessToken,
        sessionId: result.sessionId,
        ...(result.organizationId !== undefined ? { organizationId: result.organizationId } : {}),
        ...(result.impersonator !== undefined ? { impersonator: result.impersonator } : {}),
        ...(result.permissions !== undefined ? { permissions: result.permissions } : {}),
      },
    };
  }

  if (result.reason !== AuthenticateWithSessionCookieFailureReason.INVALID_JWT) {
    return { auth: signed_out, expired_session_set_cookie: session_expiry_cookie() };
  }

  try {
    const refreshed = await session.refresh({ cookiePassword: workos_cookie_password() });
    if (!refreshed.authenticated || !refreshed.sealedSession) {
      return { auth: signed_out, expired_session_set_cookie: session_expiry_cookie() };
    }
    return {
      auth: {
        user: refreshed.user,
        sessionId: refreshed.sessionId,
        ...(refreshed.organizationId !== undefined
          ? { organizationId: refreshed.organizationId }
          : {}),
        ...(refreshed.impersonator !== undefined ? { impersonator: refreshed.impersonator } : {}),
        ...(refreshed.permissions !== undefined ? { permissions: refreshed.permissions } : {}),
      },
      rotated_session_set_cookie: session_set_cookie(refreshed.sealedSession),
      rotated_sealed_session: refreshed.sealedSession,
    };
  } catch {
    return { auth: signed_out, expired_session_set_cookie: session_expiry_cookie() };
  }
}

const request_auth = new WeakMap<Request, WorkosAuth>();
const request_sealed_session = new WeakMap<Request, string>();

export function prime_request_auth(request: Request, session: SessionAuthentication): void {
  request_auth.set(request, session.auth);
  if (session.rotated_sealed_session) {
    request_sealed_session.set(request, session.rotated_sealed_session);
  }
}

function current_sealed_session(request: Request): string | undefined {
  return (
    request_sealed_session.get(request) ??
    read_cookie_value(request.headers.get('cookie'), session_cookie_name)
  );
}

export async function read_workos_auth(): Promise<WorkosAuth> {
  return request_auth.get(getRequest()) ?? signed_out;
}

export async function read_signed_in_workos_auth(): Promise<WorkosAuth> {
  const auth = await read_workos_auth();
  if (!auth.user) throw redirect({ to: '/sign-in' });
  return auth;
}

export async function refresh_session_with_organization(
  organization_id: string,
): Promise<string | undefined> {
  const sealed = current_sealed_session(getRequest());
  if (!sealed) return undefined;

  const session = get_workos().userManagement.loadSealedSession({
    sessionData: sealed,
    cookiePassword: workos_cookie_password(),
  });
  const refreshed = await session.refresh({
    cookiePassword: workos_cookie_password(),
    organizationId: organization_id,
  });
  if (!refreshed.authenticated || !refreshed.sealedSession) {
    throw new Error('Refreshing the session with an organization failed');
  }
  return session_set_cookie(refreshed.sealedSession);
}

export async function build_sign_out_redirect(return_to: string): Promise<string> {
  const sealed = current_sealed_session(getRequest());
  if (!sealed) return return_to;
  try {
    const session = get_workos().userManagement.loadSealedSession({
      sessionData: sealed,
      cookiePassword: workos_cookie_password(),
    });
    return await session.getLogoutUrl({ returnTo: return_to });
  } catch {
    return return_to;
  }
}

export function session_set_cookie(sealed_session: string): string {
  return `${session_cookie_name}=${sealed_session}; ${session_cookie_attributes(session_cookie_max_age_seconds)}`;
}

export function session_expiry_cookie(): string {
  return `${session_cookie_name}=; ${session_cookie_attributes(0)}`;
}

function session_cookie_attributes(max_age_seconds: number): string {
  const attributes = ['Path=/', `Max-Age=${max_age_seconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  return attributes.join('; ');
}

export function read_cookie_value(
  cookie_header: string | null,
  cookie_name: string,
): string | undefined {
  const prefix = `${cookie_name}=`;
  const pair = cookie_header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!pair) return undefined;
  try {
    return decodeURIComponent(pair.slice(prefix.length));
  } catch {
    return undefined;
  }
}
