const crypto = require('node:crypto');
const http = require('node:http');
const { read_address_a_test_may_change } = require('./address_a_test_may_change.cjs');

const default_sign_in_address = 'https://cloud.digitalocean.com';
const scopes = 'droplet:create droplet:read regions:read sizes:read image:read ssh_key:create ssh_key:read tag:create';
const minutes_to_wait_for_the_person = 10;
const seconds_to_give_back_the_token = 5;

class DigitalOceanSignInStopped extends Error {
  constructor(reason, status = null) {
    super(status ? `${reason} ${status}` : reason);
    this.reason = reason;
    this.status = status;
  }
}

const read_sign_in_address = () => read_address_a_test_may_change('ALFERA_DIGITALOCEAN_SIGN_IN_ADDRESS', default_sign_in_address);

const random_text = (bytes) => crypto.randomBytes(bytes).toString('base64url');
const challenge_of = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

async function post_to_digitalocean(address, body, signal) {
  const answer = await fetch(address, {
    method: 'POST',
    signal,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new DigitalOceanSignInStopped(signal?.aborted ? 'stopped' : 'not_reachable');
  });
  const json = await answer.json().catch(() => null);
  if (!answer.ok) throw new DigitalOceanSignInStopped('refused', answer.status);
  if (!json) throw new DigitalOceanSignInStopped('no_token');
  return json;
}

async function register_this_app(sign_in_address, redirect_uri, signal) {
  const client = await post_to_digitalocean(`${sign_in_address}/v1/oauth/register`, {
    client_name: 'Alfera',
    client_uri: 'https://alfera.ai',
    redirect_uris: [redirect_uri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }, signal);
  return client.client_id;
}

function authorize_address({ sign_in_address, client_id, redirect_uri, state, verifier }) {
  const query = new URLSearchParams({
    client_id,
    redirect_uri,
    response_type: 'code',
    scope: scopes,
    state,
    code_challenge: challenge_of(verifier),
    code_challenge_method: 'S256',
  });
  return `${sign_in_address}/v1/oauth/authorize?${query}`;
}

const page_for_the_browser = (words) =>
  `<!doctype html><meta charset="utf-8"><title>Alfera</title><body style="font:16px system-ui;margin:4em auto;max-width:32em">${words}</body>`;

function answer_of_the_browser(url, state) {
  if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) return null;
  const code = url.searchParams.get('code');
  if (code) return { code };
  return { reason: 'not_authorized' };
}

function start_listening() {
  const server = http.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', () => reject(new DigitalOceanSignInStopped('not_reachable')));
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function wait_for_the_answer({ server, state, signal }) {
  if (signal?.aborted) return Promise.reject(new DigitalOceanSignInStopped('stopped'));
  return new Promise((resolve, reject) => {
    const stop = (error) => (clearTimeout(timer), reject(error));
    const timer = setTimeout(() => stop(new DigitalOceanSignInStopped('no_answer')), minutes_to_wait_for_the_person * 60_000);
    signal?.addEventListener('abort', () => stop(new DigitalOceanSignInStopped('stopped')), { once: true });
    server.on('request', (request, response) => {
      const answer = answer_of_the_browser(new URL(request.url, 'http://127.0.0.1'), state);
      response.writeHead(answer ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page_for_the_browser(answer ? 'Alfera has your answer. Go back to the Alfera app.' : 'Nothing here.'));
      if (!answer) return;
      clearTimeout(timer);
      answer.code ? resolve(answer.code) : reject(new DigitalOceanSignInStopped(answer.reason));
    });
  });
}

async function trade_the_code_for_a_token({ sign_in_address, client_id, redirect_uri, code, verifier, signal }) {
  const query = new URLSearchParams({ grant_type: 'authorization_code', code, client_id, code_verifier: verifier, redirect_uri });
  const answer = await post_to_digitalocean(`${sign_in_address}/v1/oauth/token?${query}`, null, signal);
  if (typeof answer.access_token !== 'string' || !answer.access_token.trim()) throw new DigitalOceanSignInStopped('no_token');
  return answer.access_token;
}

async function sign_in_to_digitalocean({ open_in_browser, signal, sign_in_address = read_sign_in_address() }) {
  const server = await start_listening();
  try {
    const redirect_uri = `http://127.0.0.1:${server.address().port}/callback`;
    const client_id = await register_this_app(sign_in_address, redirect_uri, signal);
    const [state, verifier] = [random_text(16), random_text(48)];
    const answer = wait_for_the_answer({ server, state, signal });
    open_in_browser(authorize_address({ sign_in_address, client_id, redirect_uri, state, verifier }));
    const code = await answer;
    return await trade_the_code_for_a_token({ sign_in_address, client_id, redirect_uri, code, verifier, signal });
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

async function give_back_the_token(token, sign_in_address = read_sign_in_address()) {
  await fetch(`${sign_in_address}/v1/oauth/revoke?${new URLSearchParams({ token })}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(seconds_to_give_back_the_token * 1000),
  }).catch(() => null);
}

module.exports = { sign_in_to_digitalocean, give_back_the_token, DigitalOceanSignInStopped, scopes };
