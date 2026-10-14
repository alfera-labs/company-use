const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, beforeEach, test } = require('node:test');
const { create_server_setup } = require('../src/setup/server_setup.cjs');

// The module runs `ssh`. Here the stand-in of the setup check is first on the PATH: it connects
// to nothing, writes down what it was given, and answers what the named scenario says.
const stand_in_folder = path.join(__dirname, 'setup_check');
const key = 'sk-stand-in-key-for-the-tests-0000000001';
const path_before = process.env.PATH;
let folder;
let record_file;

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'alfera-server-setup-test-'));
  record_file = path.join(folder, 'calls.jsonl');
  Object.assign(process.env, {
    PATH: `${stand_in_folder}:${path_before}`,
    ALFERA_STAND_IN_RECORD: record_file,
    ALFERA_STAND_IN_ADDRESS: 'https://203-0-113-7.sslip.io',
    ALFERA_STAND_IN_NO_WAITS: '1',
  });
});
afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));
after(() => {
  process.env.PATH = path_before;
  for (const name of ['SCENARIO', 'RECORD', 'ADDRESS', 'NO_WAITS']) delete process.env[`ALFERA_STAND_IN_${name}`];
});

const what_each_install_got_on_stdin = () =>
  fs.readFileSync(record_file, 'utf8').trim().split('\n').map(JSON.parse)
    .filter((call) => call.kind === 'install').map((call) => call.stdin);

// Connects to the stand-in server of `scenario` and gives the pieces a test looks at.
async function connect(scenario) {
  process.env.ALFERA_STAND_IN_SCENARIO = scenario;
  const screens = [];
  const setup = create_server_setup({ folder: path.join(folder, 'server_setup'), tell_progress: (progress) => screens.push(progress) });
  assert.deepEqual(await setup.check_server('203.0.113.7'), {});
  const run = async (typed_key) => {
    setup.start_install(typed_key);
    return setup.wait_for_install();
  };
  return { setup, screens, run };
}

test('the key goes to the installer as MODEL_KEY, and is dropped when the server has it', async () => {
  const { setup, run } = await connect('everything_works');
  const outcome = await run(key);
  assert.equal(outcome.kind, 'done');
  assert.deepEqual(what_each_install_got_on_stdin(), [`MODEL_KEY=${key}\n`]);
  assert.equal(setup.holds_a_key(), false);
  assert.deepEqual(setup.read_installed(), {
    address: 'https://203-0-113-7.sslip.io',
    install_dir: '/opt/alfera/source/deploy',
    has_shared_name: false,
  });
  assert.equal(setup.server_has_the_key(), true);
});

test('a second try before the server wrote its settings sends the key again', async () => {
  const { setup, run } = await connect('stops_before_the_server_has_the_key');
  assert.equal((await run(key)).reason, 'source_download_failed');
  assert.equal(setup.holds_a_key(), true);
  assert.equal((await run()).kind, 'done');
  assert.deepEqual(what_each_install_got_on_stdin(), [`MODEL_KEY=${key}\n`, `MODEL_KEY=${key}\n`]);
  assert.equal(setup.holds_a_key(), false);
});

test('a second try after the server wrote its settings sends no key', async () => {
  const { setup, run } = await connect('stops_and_works_on_a_second_try');
  assert.equal((await run(key)).reason, 'api_did_not_answer');
  assert.equal(setup.holds_a_key(), false);
  assert.equal((await run()).kind, 'done');
  assert.deepEqual(what_each_install_got_on_stdin(), [`MODEL_KEY=${key}\n`, '']);
});

test('after a lost connection the same install goes on: no row steps back, the time is the same', async () => {
  const { screens, run } = await connect('connection_lost_while_docker_installs');
  assert.equal((await run(key)).kind, 'connection_lost');
  const at_the_cut = screens.at(-1);
  assert.deepEqual(at_the_cut.rows.map((row) => row.state).slice(0, 3), ['done', 'working', 'waiting']);
  const screens_before = screens.length;
  assert.equal((await run()).kind, 'done');
  const rank = { waiting: 0, working: 1, failed: 1, done: 2 };
  let last = at_the_cut;
  for (const screen of screens.slice(screens_before)) {
    assert.equal(screen.started_at, at_the_cut.started_at);
    screen.rows.forEach((row, index) => assert.ok(rank[row.state] >= rank[last.rows[index].state], `row ${index + 1} stepped back`));
    last = screen;
  }
  assert.ok(last.rows.every((row) => row.state === 'done'));
  assert.deepEqual(what_each_install_got_on_stdin(), [`MODEL_KEY=${key}\n`, `MODEL_KEY=${key}\n`]);
});

test('after a setup that stopped with a reason, the next try starts its rows and its time again', async () => {
  const { screens, run } = await connect('stops_and_works_on_a_second_try');
  await run(key);
  const stopped = screens.at(-1);
  assert.equal(stopped.rows[6].state, 'failed');
  const screens_before = screens.length;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await run();
  const first_of_the_new_try = screens[screens_before];
  assert.ok(first_of_the_new_try.rows.every((row) => row.state === 'waiting'));
  assert.ok(first_of_the_new_try.started_at > stopped.started_at);
});

test('a key the installer refused is typed again, not sent again', async () => {
  const { setup, run } = await connect('model_key_refused');
  assert.equal((await run(key)).reason, 'model_key_refused');
  setup.forget_the_key();
  assert.equal((await run('sk-another-stand-in-key-0000000002')).kind, 'done');
  assert.deepEqual(what_each_install_got_on_stdin(), [`MODEL_KEY=${key}\n`, 'MODEL_KEY=sk-another-stand-in-key-0000000002\n']);
});

test('the log a person copies holds the words of the server, and neither the key nor a sign-in link', async () => {
  const { setup, run } = await connect('stops_and_works_on_a_second_try');
  await run(key);
  const log = setup.read_log();
  assert.match(log, /for the check, the answers on stdin were: MODEL_KEY=\[left out\]/);
  assert.match(log, /api_did_not_answer/);
  assert.ok(!log.includes(key));
  assert.ok(!log.includes('stand-in-sign-in-token'));
});

test('the sign-in link comes back from its call and is not in the log', async () => {
  const { setup, run } = await connect('everything_works');
  await run(key);
  const outcome = await setup.read_sign_in_link();
  assert.equal(outcome.kind, 'done');
  assert.match(outcome.link, /^https:\/\/203-0-113-7\.sslip\.io\/join\/stand-in-sign-in-token/);
  assert.ok(!setup.read_log().includes('stand-in-sign-in-token'));
});

const calls_of_the_kind = (kind) =>
  fs.readFileSync(record_file, 'utf8').trim().split('\n').map(JSON.parse).filter((call) => call.kind === kind);

for (const scenario of ['server_names_another_address', 'server_names_a_folder_that_is_a_command']) {
  test(`${scenario}: the done line is not believed, nothing is kept, and no command is sent with it`, async () => {
    const { setup, run } = await connect(scenario);
    assert.deepEqual(await run(key), { kind: 'answer_not_usable' });
    assert.equal(setup.read_installed(), null);
    assert.equal(calls_of_the_kind('sign_in_link').length, 0);
    assert.equal((await run()).kind, 'done');
  });
}

test('a sign-in link that leads to another address is not given back', async () => {
  const { setup, run } = await connect('link_to_another_address');
  await run(key);
  assert.deepEqual(await setup.read_sign_in_link(), { kind: 'link_not_usable' });
  assert.equal((await setup.read_sign_in_link()).kind, 'done');
});

test('the folder goes into the link command in quotes', async () => {
  const { setup, run } = await connect('everything_works');
  await run(key);
  await setup.read_sign_in_link();
  assert.equal(calls_of_the_kind('sign_in_link')[0].called_with.at(-1), "cd '/opt/alfera/source/deploy' && ./alfera team link 10 --progress");
});

test('a name the server shares with others is told apart from a name of its own', async () => {
  const shared = await connect('server_with_a_shared_name');
  assert.equal((await shared.run(key)).has_shared_name, true);
  const own = await connect('server_with_a_name_of_its_own');
  assert.equal((await own.run(key)).has_shared_name, false);
});

test('the log is plain text: the codes a terminal reads are gone', async () => {
  const { setup, run } = await connect('stops_and_works_on_a_second_try');
  await run(key);
  const log = setup.read_log();
  assert.match(log, /words a terminal would colour: red words and the end/);
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(log));
});

test('the sentence of a failure is plain text on one line', async () => {
  const { run } = await connect('reason_from_a_newer_installer');
  const outcome = await run(key);
  assert.equal(outcome.message, 'The server ran out of something <b>this app</b> has never heard of. Try again.');
});
