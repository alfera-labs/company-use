import { digitalocean_access_token_schema } from '@api/services/company_use_deploy/deploy_schemas';
import { read_company_use_deploy_env } from '@coworker/config/company_use_deploy_env';
import { AppError, create_logger } from '@coworker/shared';

const digitalocean_sign_in_address = 'https://cloud.digitalocean.com';
const deploy_page_path = '/deploy';

const log = create_logger('company_use_deploy');

function require_client_id(client_id_of_the_page: string | undefined) {
  const client_id = client_id_of_the_page ?? read_company_use_deploy_env().digitalocean_client_id;
  if (!client_id) {
    throw new AppError('digitalocean_not_set_up', 'DigitalOcean sign-in is not set up.', 503);
  }
  return client_id;
}

function require_deploy_page_address(redirect_uri: string) {
  const allowed = read_company_use_deploy_env().page_origins.map(
    (origin) => `${origin}${deploy_page_path}`,
  );
  if (!allowed.includes(redirect_uri)) {
    throw new AppError('wrong_redirect_uri', 'The return address is not the deploy page.', 400);
  }
}

async function read_json_or_nothing(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch (error) {
    log.warn('DigitalOcean answered with no JSON', { status: answer.status, error });
    return null;
  }
}

export async function exchange_digitalocean_code(input: {
  client_id?: string | undefined;
  code: string;
  code_verifier: string;
  redirect_uri: string;
}) {
  require_deploy_page_address(input.redirect_uri);
  const { client_id, ...sign_in } = input;
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: require_client_id(client_id),
    ...sign_in,
  });
  const answer = await fetch(`${digitalocean_sign_in_address}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const parsed = digitalocean_access_token_schema.safeParse(await read_json_or_nothing(answer));
  if (!answer.ok || !parsed.success) {
    log.warn('DigitalOcean refused the code', { status: answer.status });
    throw new AppError('digitalocean_refused', 'DigitalOcean refused the sign-in.', 502);
  }
  return { access_token: parsed.data };
}

export async function revoke_digitalocean_token(token: string) {
  const answer = await fetch(
    `${digitalocean_sign_in_address}/v1/oauth/revoke?${new URLSearchParams({ token })}`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` } },
  );
  if (!answer.ok) {
    log.warn('DigitalOcean did not revoke a token', { status: answer.status });
    throw new AppError('digitalocean_refused', 'DigitalOcean did not take the token back.', 502);
  }
  return { revoked: true };
}
