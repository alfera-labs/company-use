import { post_to_deploy_api } from '@coworker/ui/lib/company_use_deploy/deploy_api';
import { DeployStopped } from '@coworker/ui/lib/company_use_deploy/deploy_problems';
import { access_token_answer_schema } from '@coworker/ui/lib/company_use_deploy/deploy_schemas';
import {
  type DeploySession,
  random_token,
  save_session,
  sha256_base64url,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';

const sign_in_address = 'https://cloud.digitalocean.com';
export const digitalocean_scopes =
  'droplet:create droplet:read droplet:delete regions:read sizes:read image:read tag:create';

export const deploy_page_address = () => `${window.location.origin}${window.location.pathname}`;

export async function leave_for_digitalocean(session: DeploySession, client_id: string) {
  const sign_in = { state: random_token(16), verifier: random_token(48) };
  save_session({ ...session, phase: 'leaving_for_digitalocean', sign_in });
  const query = new URLSearchParams({
    client_id,
    redirect_uri: deploy_page_address(),
    response_type: 'code',
    scope: digitalocean_scopes,
    state: sign_in.state,
    code_challenge: await sha256_base64url(sign_in.verifier),
    code_challenge_method: 'S256',
  });
  window.location.assign(`${sign_in_address}/v1/oauth/authorize?${query}`);
}

export type SignInAnswer = { code: string | null; state: string | null };

export function take_sign_in_answer_from_the_address(): SignInAnswer | null {
  const query = new URLSearchParams(window.location.search);
  if (!query.has('state')) return null;
  history.replaceState(null, '', window.location.pathname + window.location.hash);
  return { code: query.get('code'), state: query.get('state') };
}

export async function trade_code_for_token(
  answer: SignInAnswer,
  session: DeploySession,
  client_id: string,
) {
  if (!session.sign_in || answer.state !== session.sign_in.state)
    throw new DeployStopped('sign_in_lost');
  if (!answer.code) throw new DeployStopped('not_authorized');
  const response = await post_to_deploy_api(session.api_origin, 'digitalocean/token', {
    client_id,
    code: answer.code,
    code_verifier: session.sign_in.verifier,
    redirect_uri: deploy_page_address(),
  });
  if (response.status === 503) throw new DeployStopped('digitalocean_not_set_up');
  const parsed = access_token_answer_schema.safeParse(await response.json().catch(() => ({})));
  if (!response.ok || !parsed.success) throw new DeployStopped('not_authorized');
  return parsed.data.data.access_token;
}

export async function give_back_the_token(session: DeploySession, token: string) {
  const response = await post_to_deploy_api(session.api_origin, 'digitalocean/revoke', { token });
  if (!response.ok) console.warn('[company-use-deploy] the DigitalOcean token was not given back');
}
