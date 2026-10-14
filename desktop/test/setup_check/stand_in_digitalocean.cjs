const crypto = require('node:crypto');
const http = require('node:http');

const regions = [
  { slug: 'nyc3', available: true, sizes: ['s-2vcpu-4gb', 's-4vcpu-8gb'] },
  { slug: 'fra1', available: true, sizes: ['s-2vcpu-4gb', 's-4vcpu-8gb'] },
  { slug: 'sgp1', available: false, sizes: ['s-2vcpu-4gb'] },
];

function create_state(options) {
  return { options, calls: [], clients: new Map(), codes: new Map(), tokens: new Map(), keys: [], droplets: [] };
}

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

const challenge_of = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

function authorize(state, query, response) {
  const client = state.clients.get(query.get('client_id'));
  const redirect_uri = query.get('redirect_uri');
  const ok = client?.redirect_uris.includes(redirect_uri) && query.get('code_challenge_method') === 'S256' && query.get('response_type') === 'code';
  if (!ok) return send(response, 400, { error: 'invalid_request' });
  const answer = new URL(redirect_uri);
  answer.searchParams.set('state', query.get('state'));
  if (state.options.refuse_sign_in) answer.searchParams.set('error', 'access_denied');
  else {
    const code = crypto.randomUUID();
    state.codes.set(code, { client_id: query.get('client_id'), redirect_uri, challenge: query.get('code_challenge'), scope: query.get('scope') });
    answer.searchParams.set('code', code);
  }
  send(response, 302, {}, { location: answer.href });
}

function trade_code(state, query, response) {
  const given = state.codes.get(query.get('code'));
  state.codes.delete(query.get('code'));
  const ok = given && given.client_id === query.get('client_id') && given.redirect_uri === query.get('redirect_uri') && given.challenge === challenge_of(query.get('code_verifier') ?? '');
  if (!ok) return send(response, 401, { error: 'invalid_request' });
  const token = `doo_v1_stand_in_${crypto.randomUUID()}`;
  state.tokens.set(token, { scope: given.scope, given_back: false });
  send(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: given.scope });
}

function answer_sign_in(state, request, url, body, response) {
  const route = `${request.method} ${url.pathname}`;
  if (route === 'POST /v1/oauth/register') {
    const client_id = crypto.randomUUID();
    state.clients.set(client_id, body);
    return send(response, 201, { client_id, ...body });
  }
  if (route === 'GET /v1/oauth/authorize') return authorize(state, url.searchParams, response);
  if (route === 'POST /v1/oauth/token') return trade_code(state, url.searchParams, response);
  if (route === 'POST /v1/oauth/revoke') {
    const token = state.tokens.get(url.searchParams.get('token'));
    if (token) token.given_back = true;
    return send(response, 200, {});
  }
  return null;
}

function make_droplet(state, body, response) {
  if (state.options.refuse_server_with) return send(response, 422, { id: 'unprocessable_entity', message: state.options.refuse_server_with });
  if (state.options.refuse_server_with_status) return send(response, state.options.refuse_server_with_status, {});
  const fingerprints = state.keys.map((key) => key.fingerprint);
  if (!body.ssh_keys.every((key) => fingerprints.includes(key))) return send(response, 422, { message: 'unknown ssh key' });
  const droplet = { id: state.droplets.length + 1, ...body, size_slug: body.size, status: 'new', looks: 0, networks: { v4: [] } };
  state.droplets.push(droplet);
  send(response, 202, { droplet });
}

function look_at_droplet(state, id, response) {
  const droplet = state.droplets.find((each) => each.id === Number(id));
  droplet.looks += 1;
  if (droplet.status === 'new') droplet.status = 'active';
  droplet.networks = { v4: [{ type: 'public', ip_address: `203.0.113.${6 + droplet.id}` }] };
  send(response, 200, { droplet });
}

function answer_api(state, request, url, body, response) {
  const token = state.tokens.get((request.headers.authorization ?? '').replace('Bearer ', ''));
  if (!token || token.given_back) return send(response, 401, { id: 'Unauthorized', message: 'Unable to authenticate you' });
  const route = `${request.method} ${url.pathname}`;
  if (route === 'POST /v2/account/keys') {
    const blob = Buffer.from(body.public_key.split(' ')[1], 'base64');
    const fingerprint = crypto.createHash('md5').update(blob).digest('hex').match(/../g).join(':');
    if (state.keys.some((key) => key.fingerprint === fingerprint)) return send(response, 422, { message: 'SSH Key is already in use on your account' });
    state.keys.push({ ...body, fingerprint });
    return send(response, 201, { ssh_key: { fingerprint } });
  }
  if (route === 'GET /v2/regions') return send(response, 200, { regions });
  if (route === 'GET /v2/droplets') {
    const tag = url.searchParams.get('tag_name');
    return send(response, 200, { droplets: state.droplets.filter((droplet) => droplet.tags.includes(tag)) });
  }
  if (route === 'POST /v2/droplets') return make_droplet(state, body, response);
  const looked_at = /^GET \/v2\/droplets\/(\d+)$/.exec(route);
  if (looked_at) return look_at_droplet(state, looked_at[1], response);
  send(response, 404, { message: 'not here' });
}

async function start_stand_in_digitalocean(options = {}) {
  const state = create_state(options);
  const server = http.createServer(async (request, response) => {
    let text = '';
    for await (const piece of request) text += piece;
    const url = new URL(request.url, 'http://127.0.0.1');
    const body = text ? JSON.parse(text) : null;
    state.calls.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    if (answer_sign_in(state, request, url, body, response) === null) answer_api(state, request, url, body, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  return {
    address,
    state,
    environment: { ALFERA_DIGITALOCEAN_SIGN_IN_ADDRESS: address, ALFERA_DIGITALOCEAN_API_ADDRESS: address },
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
  };
}

const press_authorize = (link) => fetch(link).then((answer) => answer.text());

module.exports = { start_stand_in_digitalocean, press_authorize, regions };
