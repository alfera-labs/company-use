const assert = require('node:assert/strict');
const { test } = require('node:test');
const { find_server_problem } = require('../src/setup/server_setup.cjs');
const { read_ssh_failure, ssh_arguments } = require('../src/setup/ssh_call.cjs');

const call = {
  host: '203.0.113.7',
  identity_file: '/Users/someone/Library/Application Support/Alfera/server_setup/server_key',
  known_hosts_file: '/Users/someone/Library/Application Support/Alfera/server_setup/known_hosts',
  remote_command: 'true',
};

test('ssh gets a list of arguments: the key of the app, its own list of servers, no question', () => {
  const list = ssh_arguments(call);
  assert.deepEqual(list.slice(-3), ['--', 'root@203.0.113.7', 'true']);
  assert.equal(list[list.indexOf('-i') + 1], call.identity_file);
  assert.deepEqual(list.slice(0, 2), ['-F', '/dev/null']);
  for (const option of [
    'BatchMode=yes',
    'IdentitiesOnly=yes',
    'IdentityAgent=none',
    'StrictHostKeyChecking=accept-new',
    'GlobalKnownHostsFile=/dev/null',
    'ConnectTimeout=15',
    `UserKnownHostsFile="${call.known_hosts_file}"`,
  ]) {
    assert.equal(list[list.indexOf(option) - 1], '-o', option);
  }
});

test('a folder with a quote in its name is refused, because ssh would read it wrong', () => {
  assert.throws(() => ssh_arguments({ ...call, known_hosts_file: '/tmp/a"b/known_hosts' }));
});

// The words are the ones OpenSSH on a Mac prints.
test('why ssh gave up is read from its words', () => {
  assert.equal(read_ssh_failure('ssh: connect to host 203.0.113.7 port 22: Connection refused'), 'nothing_answers');
  assert.equal(read_ssh_failure('ssh: connect to host 203.0.113.7 port 22: Operation timed out'), 'nothing_answers');
  assert.equal(read_ssh_failure('ssh: Could not resolve hostname a.example.com: nodename nor servname provided, or not known'), 'nothing_answers');
  assert.equal(read_ssh_failure('root@203.0.113.7: Permission denied (publickey).'), 'key_refused');
  assert.equal(read_ssh_failure('@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.'), 'identity_changed');
  assert.equal(read_ssh_failure('client_loop: send disconnect: Broken pipe'), 'connection_lost');
  assert.equal(read_ssh_failure(''), 'connection_lost');
});

test('a fresh Ubuntu 24.04 that lets root in has no problem', () => {
  assert.equal(find_server_problem({ exit_code: 0, output: 'alfera-server-check ubuntu 24.04 0\n', log: '' }), null);
});

test('what is wrong with a server is told from what the first connection brought back', () => {
  const kind_of = (answer) => find_server_problem({ log: '', output: '', ...answer }).kind;
  assert.equal(kind_of({ exit_code: 255, log: 'root@203.0.113.7: Permission denied (publickey).' }), 'key_refused');
  assert.equal(kind_of({ exit_code: null }), 'connection_lost');
  assert.equal(kind_of({ exit_code: 0, output: 'alfera-server-check ubuntu 22.04 0\n' }), 'not_ubuntu');
  assert.equal(kind_of({ exit_code: 0, output: 'alfera-server-check debian 12 0\n' }), 'not_ubuntu');
  assert.equal(kind_of({ exit_code: 0, output: 'alfera-server-check ubuntu 24.04 1000\n' }), 'not_root');
  assert.equal(kind_of({ exit_code: 142, output: 'Please login as the user "ubuntu" rather than the user "root".\n' }), 'not_root');
  assert.equal(kind_of({ exit_code: 1, output: 'sh: 1: .: cannot open /etc/os-release' }), 'unknown_answer');
  assert.deepEqual(find_server_problem({ exit_code: 0, output: 'alfera-server-check debian 12 0\n', log: '' }), { kind: 'not_ubuntu', system: 'debian 12' });
});
