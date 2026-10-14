import { redirect_response } from '@/lib/http_response';
import {
  build_workos_callback_url,
  read_workos_return_path,
  workspace_entry_path,
} from '@/lib/workos_auth_url';
import {
  decode_oauth_return_path,
  encode_oauth_state,
  is_direct_oauth_state,
  oauth_state_matches,
  redirect_and_clear_oauth_state,
  set_oauth_state_cookie,
} from '@/lib/workos_oauth_state';
import {
  choose_workspace_for_paused_sign_in,
  finish_with_chosen_workspace,
  pending_authentication_set_cookie,
  read_pending_authentication,
} from '@/lib/workos_pending_authentication';
import {
  get_workos,
  seal_session_option,
  session_set_cookie,
  workos_client_id,
} from '@/lib/workos_session';
import type { WorkspaceProxyUser } from '@/lib/workspace_proxy_headers';

type DirectOAuthProvider = 'GoogleOAuth' | 'SlackOAuth';

export function redirect_to_google_oauth(request: Request) {
  return redirect_to_provider(request, 'GoogleOAuth');
}

export function redirect_to_slack_oauth(request: Request) {
  return redirect_to_provider(request, 'SlackOAuth');
}

function redirect_to_provider(request: Request, provider: DirectOAuthProvider) {
  const state = encode_oauth_state(read_workos_return_path(request));
  // No `organizationId` here. Alongside a social provider it does not mean "sign in to this
  // workspace" — it means "use this organization's SSO connection", so WorkOS refuses with
  // `organization_invalid` before the provider is ever reached. Which workspace the person lands
  // in is settled after the provider answers, in complete_direct_oauth.
  const authorization_url = get_workos().userManagement.getAuthorizationUrl({
    provider,
    clientId: workos_client_id(),
    redirectUri: build_workos_callback_url(request),
    state,
  });
  const response = redirect_response(authorization_url);
  set_oauth_state_cookie(response, state);
  return response;
}

export function is_direct_oauth_callback(request: Request) {
  return is_direct_oauth_state(new URL(request.url).searchParams.get('state'));
}

export async function complete_direct_oauth(request: Request) {
  const search_params = new URL(request.url).searchParams;
  const state = search_params.get('state') ?? '';
  const return_to = decode_oauth_return_path(state);
  try {
    const provider_error = search_params.get('error');
    if (provider_error) {
      const description = search_params.get('error_description') ?? '';
      throw new Error(`OAuth provider refused the sign-in: ${provider_error} ${description}`);
    }
    const code = search_params.get('code');
    if (!code) throw new Error('OAuth callback is missing the code parameter');
    if (!oauth_state_matches(request, state)) {
      throw new Error('OAuth state does not match the browser that started the sign-in');
    }
    const authentication = await get_workos().userManagement.authenticateWithCode({
      clientId: workos_client_id(),
      code,
      session: seal_session_option(),
    });
    return signed_in_redirect(request, authentication, workspace_entry_path(return_to));
  } catch (error) {
    return finish_or_hand_over(request, error, return_to);
  }
}

function signed_in_redirect(
  request: Request,
  authentication: { sealedSession?: string },
  path: string,
) {
  if (!authentication.sealedSession) {
    throw new Error('WorkOS did not return a sealed session for a sealed authenticate call');
  }
  const response = redirect_and_clear_oauth_state(request, path);
  response.headers.append('Set-Cookie', session_set_cookie(authentication.sealedSession));
  return response;
}

async function finish_or_hand_over(request: Request, error: unknown, return_to: string) {
  const pending = read_pending_authentication(error);

  if (pending?.plan === 'in_app' && pending.state === 'organization_selection_required') {
    const finished = await finish_in_resolved_workspace(request, pending, return_to);
    if (finished) return finished;
  }

  if (pending?.plan === 'in_app' && pending.state === 'email_verification_required') {
    return ask_for_email_verification(request, pending.token, pending.email, return_to);
  }

  console.error(
    `Direct OAuth sign-in handed over to hosted AuthKit${pending ? ` (${pending.state})` : ''}`,
    error,
  );
  return redirect_and_clear_oauth_state(
    request,
    `/auth/sign-in?returnTo=${encodeURIComponent(return_to)}`,
  );
}

async function finish_in_resolved_workspace(
  request: Request,
  pending: { token: string; user: WorkspaceProxyUser },
  return_to: string,
) {
  try {
    const organization_id = await choose_workspace_for_paused_sign_in(pending.user);
    const authentication = await finish_with_chosen_workspace(pending.token, organization_id);
    return signed_in_redirect(request, authentication, workspace_entry_path(return_to));
  } catch (error) {
    console.error('Resolving the workspace for a paused sign-in failed', error);
    return undefined;
  }
}

function ask_for_email_verification(
  request: Request,
  token: string,
  email: string,
  return_to: string,
) {
  const verify_url = `/sign-in?verify=email&email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(return_to)}`;
  const response = redirect_and_clear_oauth_state(request, verify_url);
  response.headers.append('Set-Cookie', pending_authentication_set_cookie(token));
  return response;
}
