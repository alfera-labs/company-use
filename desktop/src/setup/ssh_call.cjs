const { spawn } = require('node:child_process');

const seconds_to_wait_for_a_connection = 15;
const most_log_characters_kept = 60_000;

// The arguments for the ssh of the Mac, as a list: no shell reads them. The app signs in with
// its own key and nothing else, keeps its own list of servers it has met, and never asks a
// question. A server met for the first time is remembered; one whose identity changed since is
// refused. `host` must have passed parse_server_address.
function ssh_arguments({ host, identity_file, known_hosts_file, remote_command }) {
  if ([identity_file, known_hosts_file].some((file) => file.includes('"'))) {
    throw new Error('The folder of the app has a quote in its name, which ssh cannot read.');
  }
  const options = {
    BatchMode: 'yes',
    IdentitiesOnly: 'yes',
    IdentityAgent: 'none',
    PreferredAuthentications: 'publickey',
    UserKnownHostsFile: `"${known_hosts_file}"`,
    GlobalKnownHostsFile: '/dev/null',
    StrictHostKeyChecking: 'accept-new',
    ConnectTimeout: seconds_to_wait_for_a_connection,
    ServerAliveInterval: 15,
    ServerAliveCountMax: 4,
    LogLevel: 'ERROR',
  };
  const option_arguments = Object.entries(options).flatMap(([name, value]) => ['-o', `${name}=${value}`]);
  return ['-F', '/dev/null', '-T', '-i', identity_file, ...option_arguments, '--', `root@${host}`, remote_command];
}

// Why ssh itself gave up, read from the words it printed. ssh has no code for each reason.
const failures_by_the_words_of_ssh = [
  ['identity_changed', /HOST IDENTIFICATION HAS CHANGED|Host key verification failed/],
  ['key_refused', /Permission denied/],
  ['nothing_answers', /Connection refused|timed out|Could not resolve hostname|No route to host|Network is unreachable|Host is down/],
];

function read_ssh_failure(words_of_ssh) {
  const found = failures_by_the_words_of_ssh.find(([, words]) => words.test(words_of_ssh));
  return found ? found[0] : 'connection_lost';
}

// Runs ssh and gives it `text_for_stdin`, which is how a secret reaches the server: it is in
// no argument and in no file. Resolves with the exit code and the end of what ssh and the
// server wrote to the log channel.
function run_ssh({ arguments: argument_list, text_for_stdin = '', on_output = () => {}, seconds_to_run }) {
  const ssh = spawn('ssh', argument_list, { stdio: ['pipe', 'pipe', 'pipe'] });
  let log = '';
  ssh.stdout.setEncoding('utf8').on('data', on_output);
  ssh.stderr.setEncoding('utf8').on('data', (piece) => {
    log = (log + piece).slice(-most_log_characters_kept);
  });
  ssh.stdin.on('error', () => {});
  ssh.stdin.end(text_for_stdin);
  const timer = seconds_to_run ? setTimeout(() => ssh.kill(), seconds_to_run * 1000) : null;
  const finished = new Promise((resolve) => {
    ssh.on('error', (error) => resolve({ exit_code: null, log: `${log}${error.message}\n` }));
    ssh.on('close', (exit_code) => resolve({ exit_code, log }));
  }).finally(() => clearTimeout(timer));
  return { finished, stop: () => ssh.kill() };
}

module.exports = { ssh_arguments, read_ssh_failure, run_ssh };
