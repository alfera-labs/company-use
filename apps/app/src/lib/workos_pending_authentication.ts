import { getRequest } from '@tanstack/react-start/server';
import {
  get_workos,
  read_cookie_value,
  seal_session_option,
  workos_client_id,
} from '@/lib/workos_session';
import { provision_workos_workspace } from '@/lib/workos_workspace_api';
import type { WorkspaceProxyUser } from '@/lib/workspace_proxy_headers';

// Every WorkOS authenticate call — a provider code, a magic-auth code, a resumed sign-in — answers
// with a session or stops short, because it needs one more fact before it will mint one. Each stop
// carries a `pending_authentication_token` that resumes that exact sign-in, and every stop is
// listed here. Handling them one at a time as users hit them is how you ship a login that works
// for whoever tested it and nobody else, so this table is the whole set, including the ones
// Alfera does not answer itself.
//
// `in_app`  Alfera asks the question on its own page and resumes the sign-in.
// `hosted`  the question needs screens WorkOS owns (enrolling an authenticator, an SMS
//           challenge, routing to a corporate identity provider). The person is handed to the
//           hosted flow, which has rendered these since before Alfera had a login page.
const pending_authentication_plan = {
  organization_selection_required: 'in_app',
  email_verification_required: 'in_app',
  mfa_enrollment: 'hosted',
  mfa_challenge: 'hosted',
  sso_required: 'hosted',
  radar_email_challenge_required: 'hosted',
  radar_sms_challenge_required: 'hosted',
} as const satisfies Record<string, 'in_app' | 'hosted'>;

type PendingAuthenticationState = keyof typeof pending_authentication_plan;

type PendingAuthentication =
  | {
      plan: 'in_app';
      state: 'organization_selection_required';
      token: string;
      user: WorkspaceProxyUser;
    }
  | { plan: 'in_app'; state: 'email_verification_required'; token: string; email: string }
  | { plan: 'hosted'; state: PendingAuthenticationState };

export const is_secure_cookie = process.env.NODE_ENV === 'production';
const pending_authentication_cookie = is_secure_cookie
  ? '__Host-wos-pending-authentication'
  : 'wos-pending-authentication';
const pending_authentication_lifetime_seconds = 15 * 60;

export function read_pending_authentication(error: unknown): PendingAuthentication | undefined {
  const shape = error as {
    code?: unknown;
    pendingAuthenticationToken?: unknown;
    rawData?: { email?: unknown; user?: unknown };
  };
  if (typeof shape.code !== 'string') return undefined;
  const plan = pending_authentication_plan[shape.code as PendingAuthenticationState];
  if (!plan) return undefined;
  const state = shape.code as PendingAuthenticationState;

  const token =
    typeof shape.pendingAuthenticationToken === 'string' ? shape.pendingAuthenticationToken : '';
  if (plan === 'hosted' || !token) return { plan: 'hosted', state };

  if (state === 'organization_selection_required') {
    const user = read_paused_user(shape.rawData);
    if (!user) return { plan: 'hosted', state };
    return { plan: 'in_app', state, token, user };
  }
  if (state === 'email_verification_required') {
    const email = typeof shape.rawData?.email === 'string' ? shape.rawData.email : '';
    return { plan: 'in_app', state, token, email };
  }
  return { plan: 'hosted', state };
}

function read_paused_user(
  raw_data: { user?: unknown } | undefined,
): WorkspaceProxyUser | undefined {
  const user = raw_data?.user as
    | { id?: unknown; email?: unknown; first_name?: unknown; last_name?: unknown }
    | undefined;
  if (typeof user?.id !== 'string') return undefined;
  return {
    id: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    firstName: typeof user.first_name === 'string' ? user.first_name : null,
    lastName: typeof user.last_name === 'string' ? user.last_name : null,
  };
}

export function read_pending_authentication_token(request: Request) {
  return read_cookie_value(request.headers.get('cookie'), pending_authentication_cookie);
}

export async function has_pending_authentication() {
  const cookie_header = getRequest().headers.get('cookie');
  return Boolean(read_cookie_value(cookie_header, pending_authentication_cookie));
}

export function pending_authentication_set_cookie(token: string) {
  return `${pending_authentication_cookie}=${token}; ${cookie_attributes(pending_authentication_lifetime_seconds)}`;
}

export function pending_authentication_expiry_cookie() {
  return `${pending_authentication_cookie}=; ${cookie_attributes(0)}`;
}

function cookie_attributes(max_age_seconds: number) {
  const attributes = [`Path=/`, `Max-Age=${max_age_seconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (is_secure_cookie) attributes.push('Secure');
  return attributes.join('; ');
}

export async function choose_workspace_for_paused_sign_in(user: WorkspaceProxyUser) {
  const { organizationId } = await provision_workos_workspace({ user });
  return organizationId;
}

export async function finish_with_chosen_workspace(token: string, organization_id: string) {
  return get_workos().userManagement.authenticateWithOrganizationSelection({
    clientId: workos_client_id(),
    pendingAuthenticationToken: token,
    organizationId: organization_id,
    session: seal_session_option(),
  });
}

export async function finish_with_verified_email(token: string, code: string) {
  return get_workos().userManagement.authenticateWithEmailVerification({
    clientId: workos_client_id(),
    pendingAuthenticationToken: token,
    code,
    session: seal_session_option(),
  });
}
