// What the stand-in for ssh answers, for each way a setup can go. The app makes three kinds of
// call: "check" (is it a fresh Ubuntu), "install", and "sign_in_link". Each kind has a list of
// answers: the first call gets the first one, and the last answer repeats.
// {address} becomes the address of the stand-in server, {key} the text the call got on stdin.
const sign_in_token = 'stand-in-sign-in-token-0000000001';
const install_dir = '/opt/alfera/source/deploy';

const steps_in_order = ['tools', 'docker', 'source', 'settings', 'api_image', 'app_image', 'start', 'api', 'dashboard', 'https'];
const line = (step, state, extras = {}) => JSON.stringify({ step, state, ...extras });
const both_lines_of = (step) => [line(step, 'started'), line(step, 'done')];
const lines_before = (step) => steps_in_order.slice(0, steps_in_order.indexOf(step)).flatMap(both_lines_of);

// The log channel of a real install holds the words of the installer. The two lines "for the
// check" hold a key and a link on purpose: the app must keep both out of the log it shows.
const words_on_the_log_channel = [
  'using the model key from the answers',
  'for the check, words a terminal would colour: \x1b[1;31mred words\x1b[0m\x07 and \x1b]0;a window title\x07the end',
  'for the check, the answers on stdin were: {key}',
  `for the check, a link: {address}/join/${sign_in_token}`,
].join('\n');

const install_that_works = {
  output: [
    'a line that is not JSON',
    line('a_step_from_a_newer_installer', 'started'),
    ...steps_in_order.flatMap(both_lines_of),
    line('install', 'done', { changed: 'yes', address: '{address}', install_dir }),
  ],
  log: words_on_the_log_channel,
  exit_code: 0,
};

// The server says it is done, and says something about itself that the app must not believe.
const install_done_with = (extras) => ({
  ...install_that_works,
  output: [...steps_in_order.flatMap(both_lines_of), line('install', 'done', { changed: 'yes', address: '{address}', install_dir, ...extras })],
});

const install_that_stops = (step, reason, message) => ({
  output: [...lines_before(step), line(step, 'started'), line(step, 'failed', { reason, message })],
  log: words_on_the_log_channel,
  exit_code: 1,
});

const fresh_ubuntu = { output: ['alfera-server-check ubuntu 24.04 0'], exit_code: 0 };
const link_that_works = {
  output: [line('sign_in_link', 'done', { link: `{address}/join/${sign_in_token}`, minutes: '10' })],
  exit_code: 0,
};
const everything_works = { check: [fresh_ubuntu], install: [install_that_works], sign_in_link: [link_that_works] };

// The words are the ones the ssh of a Mac prints for each of these.
const ssh_gives_up = (words) => ({ output: [], log: words, exit_code: 255 });

// A connection that is cut: the lines so far, and ssh gives up. On the server the install goes
// on, so the next run shows the same install again from its first line, to its end.
const install_cut_while = (step) => ({
  output: [...lines_before(step), line(step, 'started')],
  log: 'Connection to 203.0.113.7 closed by remote host.',
  exit_code: 255,
});

const sentences = {
  install_running: 'Setup is still running on this server. Try again in a minute.',
  install_interrupted: 'Setup was interrupted on the server. Try again.',
  not_enough_memory: 'This server has too little memory. Choose a server with at least 4 GB of memory, then try again.',
  source_download_failed: 'The server could not download Alfera. Check that the server can reach the internet, then try again.',
  model_key_refused: 'The model provider refused that key. Check the key, then try again.',
  api_did_not_answer: 'Alfera started but did not answer in time. Try again in a minute.',
  docker_install_failed: 'Docker could not be installed on this server. Start again with a fresh Ubuntu server.',
  https_name_not_usable: 'The server could not work out its public address. Enter the name people will open, then try again.',
  from_a_newer_installer: 'The server ran out of something <b>this app</b> has never heard of. Try again.',
  certificate_not_issued: 'The server did not get its security certificate. Check that the name points at this server and that ports 80 and 443 are open, then try again.',
  sign_in_link_not_made: 'Alfera made no sign-in link. Try again in a minute.',
  sign_in_through_workos: 'This Alfera signs people in through WorkOS, so it makes no sign-in links.',
};

const scenarios = {
  everything_works,
  an_address_that_is_not_one: everything_works,
  a_key_that_is_not_one: everything_works,
  nothing_answers: {
    ...everything_works,
    check: [ssh_gives_up('ssh: connect to host 203.0.113.7 port 22: Operation timed out'), fresh_ubuntu],
  },
  key_refused: {
    ...everything_works,
    check: [ssh_gives_up('root@203.0.113.7: Permission denied (publickey).'), fresh_ubuntu],
  },
  identity_changed: {
    ...everything_works,
    check: [
      ssh_gives_up('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nHost key verification failed.'),
      fresh_ubuntu,
    ],
  },
  not_ubuntu: { ...everything_works, check: [{ output: ['alfera-server-check debian 12 0'], exit_code: 0 }, fresh_ubuntu] },
  not_root: {
    ...everything_works,
    check: [{ output: ['Please login as the user "ubuntu" rather than the user "root".'], exit_code: 142 }, fresh_ubuntu],
  },
  model_key_refused: {
    ...everything_works,
    install: [install_that_stops('settings', 'model_key_refused', sentences.model_key_refused), install_that_works],
  },
  stops_and_works_on_a_second_try: {
    ...everything_works,
    install: [install_that_stops('api', 'api_did_not_answer', sentences.api_did_not_answer), install_that_works],
  },
  needs_a_new_server: {
    ...everything_works,
    install: [install_that_stops('docker', 'docker_install_failed', sentences.docker_install_failed), install_that_works],
  },
  needs_another_address: {
    ...everything_works,
    install: [install_that_stops('settings', 'https_name_not_usable', sentences.https_name_not_usable), install_that_works],
  },
  // The sentence comes with codes for a terminal around it, and with a tag in it.
  reason_from_a_newer_installer: {
    ...everything_works,
    install: [
      install_that_stops('start', 'a_reason_this_app_does_not_know', `\x1b[31m${sentences.from_a_newer_installer}\x1b[0m\x07`),
      install_that_works,
    ],
  },
  server_names_another_address: {
    ...everything_works,
    install: [install_done_with({ address: 'https://elsewhere.example.com' }), install_that_works],
  },
  server_names_a_folder_that_is_a_command: {
    ...everything_works,
    install: [install_done_with({ install_dir: "/opt/alfera'; touch /tmp/alfera-check; '" }), install_that_works],
  },
  link_to_another_address: {
    ...everything_works,
    sign_in_link: [
      { output: [line('sign_in_link', 'done', { link: `https://elsewhere.example.com/join/${sign_in_token}`, minutes: '10' })], exit_code: 0 },
      link_that_works,
    ],
  },
  server_with_a_shared_name: { ...everything_works, install: [install_done_with({ name_kind: 'shared' })] },
  server_with_a_name_of_its_own: { ...everything_works, install: [install_done_with({ name_kind: 'own' })] },
  no_certificate_for_the_sign_in: {
    ...everything_works,
    sign_in_link: [
      { output: [line('sign_in_link', 'failed', { reason: 'certificate_not_issued', message: sentences.certificate_not_issued })], exit_code: 1 },
      link_that_works,
    ],
  },
  connection_lost_after_the_server_has_the_key: {
    ...everything_works,
    install: [install_cut_while('api_image'), install_that_works],
  },
  connection_lost_while_docker_installs: {
    ...everything_works,
    install: [install_cut_while('docker'), install_that_works],
  },
  stops_before_the_server_has_the_key: {
    ...everything_works,
    install: [install_that_stops('source', 'source_download_failed', sentences.source_download_failed), install_that_works],
  },
  another_setup_is_running: {
    ...everything_works,
    install: [
      { output: [line('arguments', 'failed', { reason: 'install_running', message: sentences.install_running })], exit_code: 1 },
      install_that_works,
    ],
  },
  setup_was_interrupted: {
    ...everything_works,
    install: [
      { output: [...lines_before('app_image'), line('app_image', 'failed', { reason: 'install_interrupted', message: sentences.install_interrupted })], exit_code: 1 },
      install_that_works,
    ],
  },
  needs_a_bigger_server: {
    ...everything_works,
    install: [install_that_stops('api_image', 'not_enough_memory', sentences.not_enough_memory), install_that_works],
  },
  setup_does_not_start: {
    ...everything_works,
    install: [{ output: [], log: 'curl: (22) The requested URL returned error: 404', exit_code: 22 }, install_that_works],
  },
  no_sign_in_link: {
    ...everything_works,
    sign_in_link: [
      { output: [line('sign_in_link', 'failed', { reason: 'sign_in_link_not_made', message: sentences.sign_in_link_not_made })], exit_code: 1 },
      link_that_works,
    ],
  },
  installer_does_not_answer: everything_works,
  a_small_window: everything_works,
  // The command that downloads the installer fails every time.
  ways_out_of_a_setup_that_stopped: {
    ...everything_works,
    install: [{ output: [], log: 'curl: (22) The requested URL returned error: 404', exit_code: 22 }],
  },
  change_address_while_the_setup_works: everything_works,
  digitalocean_makes_the_server: {
    ...everything_works,
    check: [ssh_gives_up('root@203.0.113.7: Permission denied (publickey).'), fresh_ubuntu],
  },
  digitalocean_sign_in_refused: everything_works,
  digitalocean_stop_while_waiting: everything_works,
  digitalocean_new_server_after_a_failed_install: {
    ...everything_works,
    install: [install_that_stops('docker', 'docker_install_failed', sentences.docker_install_failed), install_that_works],
  },
  digitalocean_makes_no_server: everything_works,
  // The link at the end of the setup works. Later the server makes no link once, then one.
  new_sign_in_link_from_my_server: {
    ...everything_works,
    sign_in_link: [
      link_that_works,
      { output: [line('sign_in_link', 'failed', { reason: 'sign_in_link_not_made', message: sentences.sign_in_link_not_made })], exit_code: 1 },
      link_that_works,
    ],
  },
  server_with_its_own_sign_in: {
    ...everything_works,
    sign_in_link: [
      { output: [line('sign_in_link', 'failed', { reason: 'sign_in_through_workos', message: sentences.sign_in_through_workos })], exit_code: 1 },
    ],
  },
};

module.exports = { scenarios, sentences, sign_in_token, install_dir };
