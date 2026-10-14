import {
  type ChatgptSignInAttempt,
  code_challenge_of,
  create_chatgpt_sign_in_attempt,
  derive_chatgpt_agent_host_id,
  open_chatgpt_sign_in_attempt,
  seal_chatgpt_sign_in_attempt,
} from '@api/services/models/chatgpt_sign_in_attempt';
import { verify_chatgpt_id_token } from '@api/services/models/chatgpt_sign_in_id_token';
import {
  type ChatgptPlanTokenResponse,
  chatgpt_plan_auth_base_url,
  chatgpt_plan_resource,
  chatgpt_plan_token_values,
  chatgpt_plan_usage_scope,
  chatgpt_plan_value_names,
  list_chatgpt_plan_model_ids,
  read_granted_scopes,
  request_chatgpt_plan_tokens,
} from '@coworker/runtime-platform';
import { AppError } from '@coworker/shared';

const authorize_url = `${chatgpt_plan_auth_base_url}/api/accounts/authorize`;
const first_registration_client_id = 'dynamic_agent_client';
const app_name = 'Alfera';
const loopback_redirect_uri = 'http://127.0.0.1:1455/auth/callback';
const requested_scopes = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  chatgpt_plan_usage_scope,
];

export type ChatgptSignInStart = {
  authorize_url: string;
  sign_in_attempt: string;
  expires_time: string;
};

export type ChatgptSignInResult = {
  provider_slot: 'chatgpt_plan';
  env_name: string;
  display_name: string;
  values: Record<string, string>;
  account: { email: string | null; subject: string };
};

/**
 * Starts OpenAI's sign-in for open-source and self-hosted apps. The browser lands on a loopback
 * address afterwards; the person pastes that address back, and the code in it is redeemed here.
 */
export function start_chatgpt_sign_in(
  input: { bound_to?: string; saved_client_id?: string; id_token_hint?: string } = {},
): ChatgptSignInStart {
  const attempt = create_chatgpt_sign_in_attempt({
    redirect_uri: loopback_redirect_uri,
    client_id: input.saved_client_id,
    bound_to: input.bound_to,
  });
  const url = new URL(authorize_url);
  for (const [name, value] of Object.entries(authorize_parameters(attempt, input))) {
    url.searchParams.set(name, value);
  }
  return {
    authorize_url: url.toString(),
    sign_in_attempt: seal_chatgpt_sign_in_attempt(attempt),
    expires_time: new Date(attempt.expires_at_ms).toISOString(),
  };
}

export async function finish_chatgpt_sign_in(input: {
  sign_in_attempt: string;
  callback_url: string;
  bound_to?: string;
}): Promise<ChatgptSignInResult> {
  const attempt = open_chatgpt_sign_in_attempt(input.sign_in_attempt, input.bound_to);
  const callback = read_callback(input.callback_url, attempt);
  const received_time_ms = Date.now();
  const tokens = await request_chatgpt_plan_tokens({
    grant_type: 'authorization_code',
    client_id: callback.client_id,
    code: callback.code,
    code_verifier: attempt.code_verifier,
    redirect_uri: attempt.redirect_uri,
  });
  const identity = await verify_chatgpt_id_token(tokens.id_token, {
    client_id: callback.client_id,
    nonce: attempt.nonce,
  });
  require_plan_usage_scope(tokens);
  if (!tokens.refresh_token) throw sign_in_error('ChatGPT sent no refresh token. Start again.');
  const model_ids = await list_chatgpt_plan_model_ids(tokens.access_token);
  if (model_ids.length === 0) throw plan_without_models_error();

  return {
    provider_slot: 'chatgpt_plan',
    env_name: chatgpt_plan_value_names.access_token,
    display_name: 'ChatGPT',
    values: {
      ...chatgpt_plan_token_values(tokens, received_time_ms),
      [chatgpt_plan_value_names.client_id]: callback.client_id,
      [chatgpt_plan_value_names.model_ids]: model_ids.join(','),
    },
    account: identity,
  };
}

function authorize_parameters(
  attempt: ChatgptSignInAttempt,
  input: { saved_client_id?: string; id_token_hint?: string },
): Record<string, string> {
  return {
    response_type: 'code',
    client_id: input.saved_client_id ?? first_registration_client_id,
    ...(input.saved_client_id ? {} : { agent_name_hint: app_name }),
    ...(input.id_token_hint ? { id_token_hint: input.id_token_hint } : {}),
    ext_agent_host_id: derive_chatgpt_agent_host_id(),
    redirect_uri: attempt.redirect_uri,
    scope: requested_scopes.join(' '),
    resource: chatgpt_plan_resource,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: code_challenge_of(attempt),
  };
}

function read_callback(callback_url: string, attempt: ChatgptSignInAttempt) {
  const parameters = read_callback_parameters(callback_url);
  if (parameters.get('state') !== attempt.state) {
    throw sign_in_error('This address is from a different sign-in. Start again.');
  }
  const error = parameters.get('error');
  if (error === 'access_denied') {
    throw new AppError(
      'chatgpt_sign_in_cancelled',
      'ChatGPT sign-in was cancelled. Try again, or paste an API key.',
      400,
    );
  }
  if (error) throw sign_in_error(`ChatGPT stopped the sign-in: ${error}.`);

  const code = parameters.get('code');
  const client_id = parameters.get('client_id') ?? attempt.client_id;
  if (!code || !client_id) throw sign_in_error('This address has no sign-in code. Start again.');
  if (attempt.client_id && client_id !== attempt.client_id) {
    throw sign_in_error('ChatGPT answered for a different connection. Start again.');
  }
  return { code, client_id };
}

function read_callback_parameters(callback_url: string): URLSearchParams {
  const text = callback_url.trim();
  try {
    return new URL(text).searchParams;
  } catch {
    return new URLSearchParams(text.slice(text.indexOf('?') + 1));
  }
}

function require_plan_usage_scope(tokens: ChatgptPlanTokenResponse) {
  if (read_granted_scopes(tokens).includes(chatgpt_plan_usage_scope)) return;
  throw new AppError(
    'chatgpt_plan_not_shared',
    'This ChatGPT account cannot share its plan with apps. Use Plus or Pro, or paste an API key.',
    403,
  );
}

function plan_without_models_error() {
  return new AppError(
    'chatgpt_plan_not_shared',
    'This ChatGPT account offers no models to apps. Use Plus or Pro, or paste an API key.',
    403,
  );
}

function sign_in_error(message: string) {
  return new AppError('chatgpt_sign_in_failed', message, 400);
}
