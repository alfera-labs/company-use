const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  action_by_reason,
  answers_for_the_installer,
  default_installer_address,
  install_command,
  is_sign_in_link_of,
  progress_rows,
  read_installed_server,
  read_installer_source,
  read_next_move,
  sign_in_link_command,
  words_of_the_app_by_reason,
} = require('../src/setup/installer_contract.cjs');
const { setup_steps } = require('../src/setup/setup_steps.js');

// Every reason id of the installer's contract, as its tables list them: the installer first,
// then the helper. A new id in the contract goes here, and the test then asks for its action.
const reasons_of_the_installer = [
  'bad_arguments', 'state_folder_not_safe', 'own_domain_needed', 'install_running', 'install_interrupted',
  'unsupported_machine', 'not_enough_memory',
  'curl_missing', 'openssl_missing', 'git_missing', 'tar_missing',
  'docker_not_installed', 'docker_not_running', 'docker_not_reachable', 'docker_install_failed',
  'docker_compose_missing', 'docker_socket_unreadable', 'source_download_failed',
  'model_key_missing', 'model_key_refused', 'setting_has_line_break',
  'own_model_name_missing', 'own_model_not_answering',
  'database_from_earlier_install', 'https_name_not_usable', 'installed_with_other_address',
  'image_build_failed', 'image_pull_failed', 'port_in_use', 'no_free_address_range',
  'stack_start_failed', 'api_did_not_answer', 'dashboard_did_not_answer',
  'certificate_not_issued', 'sign_in_link_not_made', 'unexpected', 'unlisted',
];
const reasons_of_the_helper = [
  'not_installed', 'served_over_https', 'own_domain_needed', 'sign_in_through_workos', 'address_missing', 'bad_address',
  'public_address_unknown', 'bad_minutes', 'setting_has_line_break', 'image_build_failed',
  'dashboard_did_not_answer', 'certificate_not_issued', 'sign_in_link_not_made', 'unexpected',
];
const step_ids = setup_steps.map((step) => step.id);
const sentence = 'One sentence from the server.';
const stopped_for = (reason) => ({ kind: 'failed', reason, message: sentence });

// One way on, and only one: a step to show, or a button that goes to a step or does work.
function ways_on(move) {
  return [move.go_to, move.action?.go_to, move.action?.work].filter(Boolean);
}

for (const [call, reasons] of [['install', reasons_of_the_installer], ['sign_in_link', reasons_of_the_helper]]) {
  for (const reason of reasons) {
    test(`${call} stopped for ${reason}: one sentence and exactly one thing to do`, () => {
      assert.ok(Object.hasOwn(action_by_reason, reason), 'the reason has an action of its own');
      const move = read_next_move(stopped_for(reason), call);
      assert.equal(move.problem, words_of_the_app_by_reason[reason] ?? sentence);
      assert.equal(ways_on(move).length, 1);
      const step = move.go_to ?? move.action.go_to;
      if (step) assert.ok(step_ids.includes(step), `${step} is a step`);
      if (move.action) assert.ok(move.action.label.length > 0);
    });
  }
}

test('a reason from a newer installer gets its sentence and "Try again"', () => {
  const move = read_next_move(stopped_for('a_reason_this_app_does_not_know'), 'install');
  assert.deepEqual(move, { problem: sentence, action: { label: 'Try again', work: 'install_again' } });
});

test('a setup that is still running, or was interrupted, gets "Try again"', () => {
  for (const reason of ['install_running', 'install_interrupted']) {
    assert.deepEqual(read_next_move(stopped_for(reason), 'install').action, { label: 'Try again', work: 'install_again' });
  }
});

test('a server with too little memory goes to the screen that makes a bigger one', () => {
  const move = read_next_move(stopped_for('not_enough_memory'), 'install');
  assert.equal(move.problem, 'This server has too little memory to build Alfera. Make a bigger server.');
  assert.deepEqual(move.action, { label: 'Make a bigger server', go_to: 'make_bigger_server' });
});

// The installer says "the model provider", "that key", "WorkOS", "the name people will open".
// The app has one name for each thing, and its sentence must fit the screen its button leads to.
test('where the installer names a thing by another name, the app says it in its own words', () => {
  const said = (reason, call = 'install') => read_next_move(stopped_for(reason), call).problem;
  assert.match(said('model_key_refused'), /API key/);
  assert.match(said('model_key_missing'), /API key/);
  assert.match(said('https_name_not_usable'), /domain name/);
  assert.match(said('public_address_unknown', 'sign_in_link'), /domain name/);
  assert.doesNotMatch(said('own_domain_needed'), /WorkOS/);
  assert.doesNotMatch(said('sign_in_through_workos', 'sign_in_link'), /WorkOS/);
  assert.doesNotMatch(said('not_enough_memory'), /4 GB/);
  assert.doesNotMatch(said('unexpected'), /ask for help/);
  for (const words of Object.values(words_of_the_app_by_reason)) {
    assert.doesNotMatch(words, /\b(?<!API )(?<!SSH )key\b/i, words);
  }
});

test('a new sign-in link asked from the server: every way it stops gives one sentence and the same button', () => {
  const ask_again = { label: 'Try again', work: 'get_sign_in_link_from_my_server' };
  for (const reason of reasons_of_the_helper) {
    const move = read_next_move(stopped_for(reason), 'new_sign_in_link');
    assert.deepEqual(move, { problem: words_of_the_app_by_reason[reason] ?? sentence, action: ask_again });
  }
  for (const kind of ['connection_lost', 'did_not_start', 'stopped', 'link_not_usable']) {
    const move = read_next_move({ kind }, 'new_sign_in_link');
    assert.deepEqual(move, { problem: 'Your server gave no sign-in link. Check that the server is running, then try again.', action: ask_again });
  }
  assert.deepEqual(read_next_move({ kind: 'done' }, 'new_sign_in_link'), { go_to: null });
});

test('a reason about a model the person hosts, which this app does not offer, gets "Try again"', () => {
  for (const reason of ['own_model_name_missing', 'own_model_not_answering']) {
    assert.ok(Object.hasOwn(action_by_reason, reason));
    assert.deepEqual(read_next_move(stopped_for(reason), 'install').action, { label: 'Try again', work: 'install_again' });
  }
});

test('a server that is not a fresh one gets "Make a new server", and one that needs a domain the address screen', () => {
  assert.deepEqual(read_next_move(stopped_for('state_folder_not_safe'), 'install').action, { label: 'Make a new server', go_to: 'make_server' });
  assert.deepEqual(read_next_move(stopped_for('own_domain_needed'), 'install').action, { label: 'Change the address', go_to: 'server_address' });
});

test('an install that is already open at its https address gets "Open Alfera"', () => {
  assert.deepEqual(read_next_move(stopped_for('served_over_https'), 'sign_in_link').action, { label: 'Open Alfera', work: 'open_without_sign_in_link' });
});

test('a refused or missing key goes back to the key screen with the sentence', () => {
  for (const reason of ['model_key_refused', 'model_key_missing', 'setting_has_line_break']) {
    assert.deepEqual(read_next_move(stopped_for(reason), 'install'), { go_to: 'api_key', problem: words_of_the_app_by_reason[reason] ?? sentence });
  }
});

test('a server that needs replacing goes to the screen that makes one', () => {
  const move = read_next_move(stopped_for('docker_install_failed'), 'install');
  assert.deepEqual(move.action, { label: 'Make a new server', go_to: 'make_server' });
});

test('a failed line with no sentence still gets one', () => {
  const move = read_next_move({ kind: 'failed', reason: 'a_reason_this_app_does_not_know', message: '' }, 'install');
  assert.match(move.problem, /^The setup stopped\./);
});

test('a run the server said nothing about gets a sentence and "Try again"', () => {
  for (const kind of ['connection_lost', 'did_not_start', 'stopped']) {
    const install = read_next_move({ kind }, 'install');
    assert.match(install.problem, /try again/i);
    assert.deepEqual(install.action, { label: 'Try again', work: 'install_again' });
    const link = read_next_move({ kind }, 'sign_in_link');
    assert.deepEqual(link.action, { label: 'Try again', go_to: 'signing_in' });
  }
});

test('a finished install goes on to the sign-in, with the line about the address for a shared name', () => {
  assert.deepEqual(read_next_move({ kind: 'done' }, 'install'), { go_to: 'signing_in' });
  assert.deepEqual(read_next_move({ kind: 'done', has_shared_name: false }, 'install'), { go_to: 'signing_in' });
  assert.deepEqual(read_next_move({ kind: 'done', has_shared_name: true }, 'install'), { go_to: 'signing_in_on_a_shared_name' });
  for (const id of ['signing_in', 'signing_in_on_a_shared_name']) assert.ok(step_ids.includes(id));
});

const server = { host: '203.0.113.7', https_name: '203-0-113-7.sslip.io' };
const told = (extras) => ({ address: 'https://203-0-113-7.sslip.io', install_dir: '/opt/alfera/source/deploy', ...extras });

test('what the server says about itself is believed when it is this server and a plain folder', () => {
  assert.deepEqual(read_installed_server(told({}), server), {
    address: 'https://203-0-113-7.sslip.io',
    install_dir: '/opt/alfera/source/deploy',
    has_shared_name: false,
  });
  assert.equal(read_installed_server(told({ name_kind: 'shared' }), server).has_shared_name, true);
  assert.equal(read_installed_server(told({ name_kind: 'own' }), server).has_shared_name, false);
  const own_name = { host: 'alfera.example.com', https_name: 'alfera.example.com' };
  assert.equal(read_installed_server(told({ address: 'https://alfera.example.com' }), own_name).address, 'https://alfera.example.com');
});

test('an address that is not https on the host the app connected to, or the name it asked for, is refused', () => {
  const refused = [
    'https://elsewhere.example.com',
    'https://203.0.113.7',
    'http://203-0-113-7.sslip.io',
    'https://203-0-113-7.sslip.io/',
    'https://203-0-113-7.sslip.io:8443',
    'https://203-0-113-7.sslip.io.elsewhere.example.com',
    'https://203-0-113-7.sslip.io@elsewhere.example.com',
    'HTTPS://203-0-113-7.SSLIP.IO',
    'file:///etc/passwd',
    '',
    undefined,
  ];
  for (const address of refused) assert.equal(read_installed_server(told({ address }), server), null, String(address));
});

test('a folder that is not a plain absolute path is refused', () => {
  const refused = [
    "/opt/alfera'; touch /tmp/x; '",
    '/opt/alfera; id',
    '/opt/alfera $(id)',
    '/opt/alfera/../../etc',
    '/opt/alfera/..',
    'opt/alfera',
    '~/alfera',
    '/opt/alfera\n/x',
    '/opt/al fera',
    `/${'a'.repeat(200)}`,
    '',
    undefined,
    42,
  ];
  for (const install_dir of refused) assert.equal(read_installed_server(told({ install_dir }), server), null, String(install_dir));
  assert.ok(read_installed_server(told({ install_dir: '/srv/alfera_2/source.v1/deploy-a' }), server));
});

test('the sign-in link is opened only when it is a link of the address of the server', () => {
  const address = 'https://203-0-113-7.sslip.io';
  assert.equal(is_sign_in_link_of(`${address}/join/a-token_01-X`, address), true);
  const refused = [
    'https://elsewhere.example.com/join/a-token',
    `${address}.elsewhere.example.com/join/a-token`,
    `${address}/join/`,
    `${address}/join/a-token/../../settings`,
    `${address}/join/a-token?next=https://elsewhere.example.com`,
    `${address}/join/a token`,
    `${address}/join/a.token`,
    `${address}/join/a%2Ftoken`,
    `${address}/home`,
    `http://203-0-113-7.sslip.io/join/a-token`,
    'javascript:alert(1)',
    '',
    undefined,
  ];
  for (const link of refused) assert.equal(is_sign_in_link_of(link, address), false, String(link));
});

test('a done line the app does not believe, and a link it does not open, get one sentence and "Try again"', () => {
  const not_usable = read_next_move({ kind: 'answer_not_usable' }, 'install');
  assert.equal(not_usable.problem, 'The setup stopped. Try again. If it stops again, copy the log: it says where the setup stopped.');
  assert.deepEqual(not_usable.action, { label: 'Try again', work: 'install_again' });
  const link = read_next_move({ kind: 'link_not_usable' }, 'sign_in_link');
  assert.equal(link.problem, 'Your server is set up, but its sign-in link could not be used. Try again.');
  assert.deepEqual(link.action, { label: 'Try again', go_to: 'signing_in' });
});

test('no certificate when the sign-in link is asked for goes to the address screen, with the sentence of the server', () => {
  assert.deepEqual(read_next_move(stopped_for('certificate_not_issued'), 'sign_in_link'), { go_to: 'server_address', problem: sentence });
  assert.deepEqual(read_next_move(stopped_for('certificate_not_issued'), 'install').action, { label: 'Try again', work: 'install_again' });
});

test('the install command is the one of the contract, and holds no key', () => {
  const source = read_installer_source({});
  assert.equal(
    install_command({ https_name: '203-0-113-7.sslip.io', ...source }),
    `curl -fsSL ${default_installer_address}/install.sh -o /root/install.sh && ` +
      'INSTALL_DIR=/opt/alfera bash /root/install.sh --unattended --progress --answers-stdin --install-docker --https=203-0-113-7.sslip.io',
  );
});

// The repository is named in one line of the app. A second place would be missed when the
// repository gets another name.
test('the public repository is named in one place: the installer address', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source_folder = path.join(__dirname, '..', 'src');
  const names_of_a_repository = /github\.com\/[\w.-]+\/[\w.-]+|githubusercontent\.com/;
  const lines_that_name_it = fs.readdirSync(source_folder, { recursive: true })
    .filter((file) => /\.(cjs|js|html)$/.test(file))
    .flatMap((file) => fs.readFileSync(path.join(source_folder, file), 'utf8').split('\n').filter((line) => names_of_a_repository.test(line)).map((line) => `${file}: ${line.trim()}`));
  assert.deepEqual(lines_that_name_it, [`setup/installer_contract.cjs: const default_installer_address = '${default_installer_address}';`]);
});

test('a test run can install from a copy of the source', () => {
  const source = read_installer_source({
    ALFERA_INSTALLER_ADDRESS: 'http://127.0.0.1:8099',
    ALFERA_INSTALLER_SOURCE_ARCHIVE: 'http://127.0.0.1:8099/alfera.tar.gz',
  });
  assert.equal(
    install_command({ https_name: 'alfera.example.com', ...source }),
    'curl -fsSL http://127.0.0.1:8099/install.sh -o /root/install.sh && ' +
      'INSTALL_DIR=/opt/alfera PRODUCT_SOURCE_ARCHIVE=http://127.0.0.1:8099/alfera.tar.gz bash /root/install.sh ' +
      '--unattended --progress --answers-stdin --install-docker --https=alfera.example.com',
  );
});

test('a value that a shell would read as more than a value never reaches a command', () => {
  const unsafe = ['http://a.example.com/$(id)', 'http://a.example.com/x y', 'http://a.example.com/;id', "http://a.example.com/'", 'file:///etc/passwd'];
  for (const address of unsafe) {
    assert.throws(() => read_installer_source({ ALFERA_INSTALLER_ADDRESS: address }), /cannot be used in a command/);
    assert.throws(() => read_installer_source({ ALFERA_INSTALLER_SOURCE_ARCHIVE: address }), /cannot be used in a command/);
  }
  assert.throws(() => install_command({ https_name: 'a.example.com;id', ...read_installer_source({}) }), /cannot be used/);
  assert.throws(() => sign_in_link_command('/opt/alfera; id'), /cannot be used/);
  assert.throws(() => sign_in_link_command("/opt/alfera'; id; '"), /cannot be used/);
  assert.throws(() => sign_in_link_command('/opt/alfera/../x'), /cannot be used/);
  assert.throws(() => sign_in_link_command('opt/alfera'), /cannot be used/);
  assert.equal(sign_in_link_command('/opt/alfera/source/deploy'), "cd '/opt/alfera/source/deploy' && ./alfera team link 10 --progress");
});

test('the key goes in as one line named MODEL_KEY, and no key gives no line', () => {
  assert.equal(answers_for_the_installer('sk-ant-filler'), 'MODEL_KEY=sk-ant-filler\n');
  assert.equal(answers_for_the_installer('sk-filler'), 'MODEL_KEY=sk-filler\n');
  assert.equal(answers_for_the_installer(null), '');
});

test('every step the installer reports has a row, and no step has two', () => {
  const steps_of_the_installer = ['tools', 'docker', 'source', 'settings', 'api_image', 'app_image', 'images', 'start', 'api', 'dashboard', 'https'];
  const steps_with_a_row = progress_rows.flatMap((row) => row.steps);
  assert.deepEqual([...steps_with_a_row].sort(), [...steps_of_the_installer].sort());
});
