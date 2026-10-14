import { redirect_response } from '@/lib/http_response';
import {
  build_workos_callback_url,
  read_workos_return_path,
  workspace_entry_path,
} from '@/lib/workos_auth_url';
import { complete_direct_oauth, is_direct_oauth_callback } from '@/lib/workos_direct_oauth';
import {
  decode_hosted_nonce,
  decode_hosted_return_path,
  encode_hosted_state,
  hosted_auth_expiry_cookie,
  hosted_auth_set_cookie,
  read_hosted_auth_verifier,
} from '@/lib/workos_hosted_auth_state';
import {
  get_workos,
  seal_session_option,
  session_set_cookie,
  workos_client_id,
} from '@/lib/workos_session';

export async function workos_auth_callback(request: Request) {
  if (is_direct_oauth_callback(request)) return complete_direct_oauth(request);
  return complete_hosted_callback(request);
}

export async function redirect_to_workos_sign_in(request: Request) {
  const search_params = new URL(request.url).searchParams;
  const email = search_params.get('email')?.trim();
  const screen_hint = search_params.get('screen') === 'sign-up' ? 'sign-up' : 'sign-in';
  const { state, nonce } = encode_hosted_state(
    workspace_entry_path(read_workos_return_path(request)),
  );
  const pkce = await get_workos().pkce.generate();

  const sign_in_url = get_workos().userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: workos_client_id(),
    redirectUri: build_workos_callback_url(request),
    screenHint: screen_hint,
    state,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
    ...(email ? { loginHint: email } : {}),
  });

  const response = redirect_response(sign_in_url);
  response.headers.append('Set-Cookie', hosted_auth_set_cookie(nonce, pkce.codeVerifier));
  return response;
}

async function complete_hosted_callback(request: Request) {
  const search_params = new URL(request.url).searchParams;
  const code = search_params.get('code');
  const state = search_params.get('state');
  const nonce = decode_hosted_nonce(state);

  if (!code) {
    const error = search_params.get('error') ?? 'missing_code';
    console.error(`Hosted AuthKit callback arrived without a code (${error})`);
    return refuse_hosted_callback(request, nonce);
  }

  if (!nonce) {
    console.error('Hosted AuthKit callback carried no state this app could have minted');
    return refuse_hosted_callback(request, nonce);
  }

  const code_verifier = read_hosted_auth_verifier(request, nonce);
  if (!code_verifier) {
    console.error('Hosted AuthKit callback did not come from the browser that started the sign-in');
    return refuse_hosted_callback(request, nonce);
  }

  try {
    const authentication = await get_workos().userManagement.authenticateWithCode({
      clientId: workos_client_id(),
      code,
      codeVerifier: code_verifier,
      session: seal_session_option(),
    });
    if (!authentication.sealedSession) {
      throw new Error('WorkOS did not return a sealed session for a sealed authenticate call');
    }
    const response = redirect_response(new URL(decode_hosted_return_path(state), request.url));
    response.headers.append('Set-Cookie', hosted_auth_expiry_cookie(nonce));
    response.headers.append('Set-Cookie', session_set_cookie(authentication.sealedSession));
    return response;
  } catch (error) {
    console.error('Hosted AuthKit code exchange failed', error);
    return refuse_hosted_callback(request, nonce);
  }
}

function refuse_hosted_callback(request: Request, nonce: string | undefined) {
  const response = redirect_response(new URL('/sign-in', request.url));
  if (nonce) response.headers.append('Set-Cookie', hosted_auth_expiry_cookie(nonce));
  return response;
}
