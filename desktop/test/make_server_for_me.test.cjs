const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, beforeEach, test } = require('node:test');
const { fingerprint_of, pick_region, tag_of } = require('../src/setup/digitalocean_server.cjs');
const { scopes } = require('../src/setup/digitalocean_sign_in.cjs');
const { make_server_for_me, words_by_reason } = require('../src/setup/make_server_for_me.cjs');
const { create_server_setup } = require('../src/setup/server_setup.cjs');
const { press_authorize, regions, start_stand_in_digitalocean } = require('./setup_check/stand_in_digitalocean.cjs');

const stand_in_folder = path.join(__dirname, 'setup_check');
const path_before = process.env.PATH;
let folder;
let digitalocean;

async function start(options = {}) {
  digitalocean = await start_stand_in_digitalocean(options);
  Object.assign(process.env, digitalocean.environment);
}

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'alfera-make-server-test-'));
  Object.assign(process.env, {
    PATH: `${stand_in_folder}:${path_before}`,
    ALFERA_STAND_IN_SCENARIO: 'everything_works',
    ALFERA_STAND_IN_RECORD: path.join(folder, 'calls.jsonl'),
    ALFERA_STAND_IN_ADDRESS: 'https://203-0-113-7.sslip.io',
    ALFERA_STAND_IN_NO_WAITS: '1',
  });
});
afterEach(async () => {
  await digitalocean?.close();
  fs.rmSync(folder, { recursive: true, force: true });
});
after(() => {
  process.env.PATH = path_before;
  for (const name of ['SCENARIO', 'RECORD', 'ADDRESS', 'NO_WAITS']) delete process.env[`ALFERA_STAND_IN_${name}`];
  for (const name of ['SIGN_IN_ADDRESS', 'API_ADDRESS']) delete process.env[`ALFERA_DIGITALOCEAN_${name}`];
});

function make(size = 's-2vcpu-4gb', open_in_browser = press_authorize, { addresses_given_up = [], signal = new AbortController().signal } = {}) {
  const server_setup = create_server_setup({ folder: path.join(folder, 'server_setup'), tell_progress: () => {} });
  const links = [];
  const opened = (link) => (links.push(link), open_in_browser(link));
  const outcome = make_server_for_me({ server_setup, size, addresses_given_up, open_in_browser: opened, signal });
  return { server_setup, links, outcome };
}

const calls_to = (method, call_path) => digitalocean.state.calls.filter((call) => call.method === method && call.path === call_path);
const ssh_calls = () => fs.readFileSync(process.env.ALFERA_STAND_IN_RECORD, 'utf8').trim().split('\n').map(JSON.parse);

test('one press: the person authorizes, the app makes the server with its key, connects, and gives the access back', async () => {
  await start();
  const { server_setup, links, outcome } = make();
  assert.deepEqual(await outcome, {});
  const [link] = links;
  const query = new URL(link).searchParams;
  assert.equal(query.get('code_challenge_method'), 'S256');
  assert.equal(query.get('scope'), scopes);
  assert.match(query.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.ok(!link.includes('client_secret'));
  const public_key = await server_setup.read_public_key();
  const [droplet_asked] = calls_to('POST', '/v2/droplets').map((call) => call.body);
  const region = pick_region(regions, 's-2vcpu-4gb', Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(droplet_asked, {
    name: 'alfera', region, size: 's-2vcpu-4gb', image: 'ubuntu-24-04-x64',
    ssh_keys: [fingerprint_of(public_key)], tags: ['alfera', tag_of(fingerprint_of(public_key))],
  });
  assert.equal(calls_to('POST', '/v2/account/keys')[0].body.public_key, public_key);
  assert.ok([...digitalocean.state.tokens.values()].every((token) => token.given_back), 'the token is given back');
  assert.equal(ssh_calls()[0].called_with.at(-2), 'root@203.0.113.7');
});

test('a second press uses the server made before, and makes no second one', async () => {
  await start();
  assert.deepEqual(await make().outcome, {});
  assert.deepEqual(await make().outcome, {});
  assert.equal(calls_to('POST', '/v2/droplets').length, 1);
});

test('a server that is off, or one the setup gave up on, is not used again', async () => {
  await start();
  await make().outcome;
  digitalocean.state.droplets[0].status = 'off';
  await make().outcome;
  assert.deepEqual(await make('s-2vcpu-4gb', press_authorize, { addresses_given_up: ['203.0.113.8'] }).outcome, {});
  assert.equal(calls_to('POST', '/v2/droplets').length, 3);
  assert.equal(ssh_calls().at(-1).called_with.at(-2), 'root@203.0.113.9');
});

test('a stop before the browser opens ends at once: no page opens, and nothing waits', async () => {
  await start();
  const stopped = new AbortController();
  stopped.abort();
  const { links, outcome } = make('s-2vcpu-4gb', press_authorize, { signal: stopped.signal });
  assert.deepEqual(await outcome, { problem: words_by_reason.stopped });
  assert.deepEqual(links, []);
});

test('a stop while the new server refuses the key ends the wait at once, with no second try', async () => {
  await start();
  process.env.ALFERA_STAND_IN_SCENARIO = 'digitalocean_makes_the_server';
  const stopped = new AbortController();
  const { server_setup, outcome } = make('s-2vcpu-4gb', press_authorize, { signal: stopped.signal });
  const check_server = server_setup.check_server;
  let stopped_at = null;
  server_setup.check_server = async (host) => {
    const answer = await check_server(host);
    setImmediate(() => ((stopped_at = Date.now()), stopped.abort()));
    return answer;
  };
  assert.deepEqual(await outcome, { problem: words_by_reason.stopped });
  assert.ok(Date.now() - stopped_at < 1000, 'the wait between tries does not run out');
  assert.equal(ssh_calls().filter((call) => call.kind === 'check').length, 1);
});

test('an error with no words gets its code, not a sentence about the internet connection', async () => {
  await start({ refuse_server_with_status: 500 });
  assert.deepEqual(await make().outcome, { problem: 'DigitalOcean answered with an error (code 500). Try again in a minute.' });
});

test('a bigger size is another server', async () => {
  await start();
  await make().outcome;
  assert.deepEqual(await make('s-4vcpu-8gb').outcome, {});
  assert.deepEqual(calls_to('POST', '/v2/droplets').map((call) => call.body.size), ['s-2vcpu-4gb', 's-4vcpu-8gb']);
});

test('a person who does not authorize gets one sentence, and no server is made', async () => {
  await start({ refuse_sign_in: true });
  assert.deepEqual(await make().outcome, { problem: words_by_reason.not_authorized });
  assert.equal(calls_to('POST', '/v2/droplets').length, 0);
});

test('DigitalOcean says in its own words why it made no server, and the token is given back', async () => {
  await start({ refuse_server_with: 'You must add a payment method before you can create a Droplet.' });
  const { outcome } = make();
  assert.deepEqual(await outcome, { problem: 'DigitalOcean did not make the server. It says: "You must add a payment method before you can create a Droplet."' });
  assert.ok([...digitalocean.state.tokens.values()].every((token) => token.given_back));
});

test('an answer for another sign-in is not taken', async () => {
  await start();
  const forged = (link) => {
    const query = new URL(link).searchParams;
    return fetch(`${query.get('redirect_uri')}?code=forged&state=not-the-state`).then((answer) => {
      assert.equal(answer.status, 404);
      return press_authorize(link);
    });
  };
  assert.deepEqual(await make('s-2vcpu-4gb', forged).outcome, {});
});

test('a sign-in the person leaves stops at once, with one sentence', async () => {
  await start();
  const server_setup = create_server_setup({ folder: path.join(folder, 'server_setup'), tell_progress: () => {} });
  const leave = new AbortController();
  const outcome = make_server_for_me({ server_setup, size: 's-2vcpu-4gb', open_in_browser: () => leave.abort(), signal: leave.signal });
  assert.deepEqual(await outcome, { problem: words_by_reason.stopped });
});

test('the region is the nearest one that is open and has the size', () => {
  const regions = [
    { slug: 'nyc3', available: true, sizes: ['s-2vcpu-4gb'] },
    { slug: 'fra1', available: false, sizes: ['s-2vcpu-4gb'] },
    { slug: 'ams3', available: true, sizes: ['s-4vcpu-8gb'] },
    { slug: 'lon1', available: true, sizes: ['s-2vcpu-4gb'] },
  ];
  assert.equal(pick_region(regions, 's-2vcpu-4gb', 'Europe/Rome'), 'lon1');
  assert.equal(pick_region(regions, 's-2vcpu-4gb', 'America/New_York'), 'nyc3');
  assert.equal(pick_region(regions, 's-2vcpu-4gb', 'Pacific/Auckland'), 'nyc3');
  assert.throws(() => pick_region(regions, 's-8vcpu-16gb', 'Europe/Rome'), { reason: 'no_region' });
});

test('the fingerprint is the MD5 fingerprint ssh-keygen gives, the one DigitalOcean shows', () => {
  const key_file = path.join(folder, 'key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key_file]);
  const from_ssh_keygen = execFileSync('ssh-keygen', ['-l', '-E', 'md5', '-f', `${key_file}.pub`], { encoding: 'utf8' });
  const public_key = fs.readFileSync(`${key_file}.pub`, 'utf8');
  assert.equal(`MD5:${fingerprint_of(public_key)}`, from_ssh_keygen.split(' ')[1]);
  assert.equal(tag_of('3b:16:e4:bf:8b:00:8b:b8:59:8c:a9:d3:f0:19:fa:45'), 'alfera-app-3b16e4bf8b00');
});
