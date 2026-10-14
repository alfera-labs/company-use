const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const {
  check_server_command,
  answers_for_the_installer,
  install_command,
  is_sign_in_link_of,
  progress_rows,
  read_installed_server,
  read_installer_source,
  sign_in_link_command,
  usual_time_for_the_install,
} = require('./installer_contract.cjs');
const {
  create_line_reader,
  parse_progress_line,
  read_row_states,
  read_run_outcome,
} = require('./installer_progress.cjs');
const { plain_text_of } = require('./plain_text.cjs');
const { parse_server_address } = require('./server_address.cjs');
const { read_ssh_failure, run_ssh, ssh_arguments } = require('./ssh_call.cjs');

const seconds_to_wait_for_the_server_check = 40;
const exit_code_of_ssh_itself = 255;
const words_in_place_of_a_secret = '[left out]';
// A run that ended with no last line lost its connection. The install on the server went on,
// so the next run shows that same install: its lines come again, from the first one.
const ends_with_the_install_still_at_work = ['connection_lost', 'stopped'];
const sign_in_link_in_any_text = /\/join\/[^\s"'<>]+/g;

const words_for_a_server_that_cannot_be_used = {
  no_address: () => 'That is not a server address. Enter only the address, such as 203.0.113.7.',
  nothing_answers: (host) =>
    `Nothing answers at ${host}. Check the address, wait a minute for the server to start, then try again.`,
  key_refused: () =>
    'The server refused the SSH key of this app. The SSH key was most likely not pasted when the server was made. Go back, make a new server with the SSH key, then try again.',
  identity_changed: (host) =>
    `Another server than before now answers at ${host}, so the app did not connect. Make a new server to get a new address, then enter that address.`,
  connection_lost: (host) =>
    `The connection to ${host} was lost. Check your internet connection, then try again.`,
  not_root: () =>
    'This server does not let the setup sign in as root. Go back, make a new server the way the steps say, then try again.',
  not_ubuntu: (_host, system) =>
    `This server runs ${system}, not Ubuntu 24.04. Go back, make a new server with Ubuntu 24.04, then try again.`,
  unknown_answer: () =>
    'This server answered in a way the setup does not know. Go back, make a new server with Ubuntu 24.04, then try again.',
};

// Which sentence fits what the first connection brought back, or null when the server is a
// fresh Ubuntu 24.04 that lets root in.
function find_server_problem({ exit_code, output, log }) {
  if (exit_code === exit_code_of_ssh_itself || exit_code === null) return { kind: read_ssh_failure(log) };
  const check = /^alfera-server-check (\S*) (\S*) (\S*)$/m.exec(output);
  if (!check) return { kind: /login as the user/i.test(output + log) ? 'not_root' : 'unknown_answer' };
  const [, system, version, user_number] = check;
  if (system !== 'ubuntu' || version !== '24.04') return { kind: 'not_ubuntu', system: `${system} ${version}`.trim() };
  return user_number === '0' ? null : { kind: 'not_root' };
}

// Sets up Alfera on a server the person rents, over ssh. This file owns what that takes on the
// Mac: the key pair of the app, the list of servers it has met, the list of servers it set up,
// and the run that is under way. The API key is held in memory until a server has taken it, and
// no longer. The sign-in link passes through and is kept nowhere.
function create_server_setup({ folder, tell_progress }) {
  const identity_file = path.join(folder, 'server_key');
  const known_hosts_file = path.join(folder, 'known_hosts');
  const servers_set_up_file = path.join(folder, 'servers_set_up.json');
  let server = null;
  let installed = null;
  let install_under_way = null;
  let running = null;
  let log = '';
  let key_the_server_does_not_have_yet = null;
  // A host on this list is the same server as when it took the key: the app does not connect
  // to a host whose identity changed.
  const hosts_that_have_the_key = new Set();
  // What the "Setting up" screen shows: every line of the install so far, and when it started.
  let shown = { lines: [], started_at: 0, follows_the_install_before: false };

  const call_server = (remote_command, options = {}) => {
    running = run_ssh({
      arguments: ssh_arguments({ host: server.host, identity_file, known_hosts_file, remote_command }),
      ...options,
    });
    return running.finished;
  };

  // The log is for a person to copy and send. Nothing secret may be in it, and nothing but
  // plain text: the server wrote most of it.
  function add_to_log(title, text, secret = '') {
    const without_key = secret ? text.replaceAll(secret, words_in_place_of_a_secret) : text;
    const safe = without_key.replace(sign_in_link_in_any_text, `/join/${words_in_place_of_a_secret}`);
    log += `--- ${title}\n${plain_text_of(safe).trimEnd()}\n`;
  }

  // Made once. The private half stays in the folder of the app, readable by this person only.
  async function read_public_key() {
    if (!fs.existsSync(identity_file)) {
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      const make_key = ['-q', '-t', 'ed25519', '-N', '', '-C', 'alfera-desktop', '-f', identity_file];
      await promisify(execFile)('ssh-keygen', make_key);
    }
    return fs.readFileSync(`${identity_file}.pub`, 'utf8').trim();
  }

  async function check_server(text) {
    const address = parse_server_address(text);
    if (!address) return { problem: words_for_a_server_that_cannot_be_used.no_address() };
    server = address;
    shown.follows_the_install_before = false;
    let output = '';
    const answer = await call_server(check_server_command, {
      on_output: (piece) => (output += piece),
      seconds_to_run: seconds_to_wait_for_the_server_check,
    });
    const problem = find_server_problem({ ...answer, output });
    if (!problem) return {};
    add_to_log(`connecting to ${address.host}`, answer.log);
    const words = words_for_a_server_that_cannot_be_used[problem.kind];
    return { problem: words(address.host, problem.system), kind: problem.kind };
  }

  function show_the_install() {
    const states = read_row_states(progress_rows, shown.lines);
    const rows = progress_rows.map((row, index) => ({ title: row.title, state: states[index] }));
    tell_progress({ rows, started_at: shown.started_at, usual_time: usual_time_for_the_install });
  }

  // The settings step writes the key on the server. From then on the Mac has no use for it.
  function take_lines(lines, texts) {
    const new_lines = texts.map(parse_progress_line).filter(Boolean);
    lines.push(...new_lines);
    shown.lines.push(...new_lines);
    const server_has_the_key = new_lines.some((line) => line.step === 'settings' && line.state === 'done');
    if (server_has_the_key) remember_the_server_has_the_key();
    show_the_install();
  }

  function remember_the_server_has_the_key() {
    key_the_server_does_not_have_yet = null;
    hosts_that_have_the_key.add(server.host);
  }

  // The server says it is done, and says where. That is believed only when the address is this
  // server and the folder is a plain path. If not, nothing is kept and no later call is made.
  function finish_install(outcome) {
    const told = read_installed_server(outcome, server);
    if (!told) return { kind: 'answer_not_usable' };
    installed = told;
    remember_the_server_has_the_key();
    remember_the_server_is_set_up();
    return { kind: 'done', ...told };
  }

  // The servers this app set up, by address: the host it connected to and the folder of the
  // install. No secret is in this file. It lets the person who set a server up ask it for a new
  // sign-in link later, with the SSH key the app already has for it.
  function read_servers_set_up() {
    try {
      return JSON.parse(fs.readFileSync(servers_set_up_file, 'utf8'));
    } catch {
      return {};
    }
  }

  function remember_the_server_is_set_up() {
    const servers = { ...read_servers_set_up(), [installed.address]: { host: server.host, install_dir: installed.install_dir } };
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    fs.writeFileSync(servers_set_up_file, JSON.stringify(servers, null, 2), { mode: 0o600 });
  }

  // What is written down is checked again as it was when the server said it: the address must be
  // the name of that host, and the folder a plain path.
  function read_server_set_up_at(address) {
    const kept = read_servers_set_up()[address];
    const kept_server = kept && fs.existsSync(identity_file) ? parse_server_address(kept.host) : null;
    const kept_install = kept_server && read_installed_server({ address, install_dir: kept.install_dir }, kept_server);
    return kept_install ? { server: kept_server, installed: kept_install } : null;
  }

  // Makes the server at this address the one the next call goes to. False when this app did not
  // set that server up.
  function use_server_set_up_at(address) {
    const kept = read_server_set_up_at(address);
    if (!kept) return false;
    ({ server, installed } = kept);
    return true;
  }

  // Starts the installer and returns at once; wait_for_install gives the end of the run.
  // `key` is given when the person has just typed it. A second try gives none: it sends the key
  // again only while no server has taken it. After a lost connection the screen goes on from
  // where it was: the rows it showed as done stay done, and the time keeps counting.
  function start_install(key = null) {
    if (key) key_the_server_does_not_have_yet = key;
    const key_sent = key_the_server_does_not_have_yet;
    if (!shown.follows_the_install_before) {
      shown = { lines: [], started_at: Date.now(), follows_the_install_before: false };
    }
    const lines = [];
    const reader = create_line_reader();
    show_the_install();
    install_under_way = call_server(
      install_command({ https_name: server.https_name, ...read_installer_source() }),
      {
        text_for_stdin: answers_for_the_installer(key_sent),
        on_output: (piece) => take_lines(lines, reader.read(piece)),
      },
    ).then(({ exit_code, log: words_of_the_server }) => {
      take_lines(lines, reader.read_the_rest());
      const steps = lines.map((line) => JSON.stringify(line)).join('\n');
      add_to_log('setting up', `${words_of_the_server}\n${steps}\nexit code ${exit_code}`, key_sent ?? '');
      const outcome = read_run_outcome({ lines, exit_code, last_step: 'install' });
      shown.follows_the_install_before = ends_with_the_install_still_at_work.includes(outcome.kind);
      return outcome.kind === 'done' ? finish_install(outcome) : outcome;
    });
  }

  // The link is on the output of this one call. It is returned to the caller and kept nowhere:
  // the output never reaches the log.
  async function read_sign_in_link() {
    let output = '';
    const answer = await call_server(sign_in_link_command(installed.install_dir), {
      on_output: (piece) => (output += piece),
    });
    const lines = output.split('\n').map(parse_progress_line).filter(Boolean);
    const outcome = read_run_outcome({ lines, exit_code: answer.exit_code, last_step: 'sign_in_link' });
    if (outcome.kind !== 'done') add_to_log('asking for the sign-in link', `${answer.log}\nexit code ${answer.exit_code}`);
    if (outcome.kind !== 'done') return outcome;
    // A link that leads anywhere but to this server is not opened.
    if (!is_sign_in_link_of(outcome.link, installed.address)) return { kind: 'link_not_usable' };
    return { kind: 'done', link: outcome.link };
  }

  return {
    read_public_key,
    check_server,
    start_install,
    wait_for_install: () => install_under_way,
    read_sign_in_link,
    read_installed: () => installed,
    read_host: () => server?.host ?? null,
    set_up_the_server_at: (address) => read_server_set_up_at(address) !== null,
    use_server_set_up_at,
    read_log: () => log,
    holds_a_key: () => key_the_server_does_not_have_yet !== null,
    server_has_the_key: () => hosts_that_have_the_key.has(server.host),
    forget_the_key: () => (key_the_server_does_not_have_yet = null),
    stop: () => running?.stop(),
  };
}

module.exports = { create_server_setup, find_server_problem };
