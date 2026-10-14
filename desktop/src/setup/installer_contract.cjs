// What this app and the installer on the server agree on: the commands the server runs, the
// steps it reports, and what the person can do after each reason it stops for. The installer's
// side of this is in SELF_HOSTING.md of the repository, under "Install from a program".
// This is the one place in the app that names the public repository. When the repository gets
// another name, this line changes and nothing else does.
const default_installer_address = 'https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy';
const sign_in_link_minutes = 10;
// One range for every server. It is as wide as the installs that were timed, none of
// them on a rented server. Read the times from the installer when it reports them.
const usual_time_for_the_install = '10 to 20 minutes';

// Every value below ends up inside a command a shell on the server runs. Each one is let
// through only in a shape that holds no space, no quote and no sign a shell reads.
const address_safe_in_a_command = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._/-]*)?$/;
const name_safe_in_a_command = /^[a-z0-9.-]+$/;
// The folder of the install comes from the server. It is used only when it is a plain path.
const plain_folder = /^\/[A-Za-z0-9._/-]+$/;
const most_characters_in_a_folder = 200;
const token_of_a_sign_in_link = /^[A-Za-z0-9_-]+$/;

function is_plain_folder(folder) {
  return (
    typeof folder === 'string' &&
    folder.length <= most_characters_in_a_folder &&
    plain_folder.test(folder) &&
    !folder.split('/').includes('..')
  );
}

// What the last line of the installer says about the server it set up, or null when any of it
// cannot be trusted. The address must be https on the name the app asked for, with nothing
// after it. That name is the one the person typed, or the numbers they typed as a name: the
// server does not get to send the app anywhere else.
function read_installed_server(last_line, server) {
  if (last_line.address !== `https://${server.https_name}`) return null;
  if (!is_plain_folder(last_line.install_dir)) return null;
  return {
    address: last_line.address,
    install_dir: last_line.install_dir,
    has_shared_name: last_line.name_kind === 'shared',
  };
}

// The sign-in link is opened only when it is a link of that same address.
function is_sign_in_link_of(link, address) {
  const start = `${address}/join/`;
  return typeof link === 'string' && link.startsWith(start) && token_of_a_sign_in_link.test(link.slice(start.length));
}

function require_shape(value, shape, what) {
  if (!shape.test(value)) throw new Error(`${what} cannot be used in a command: ${value}`);
  return value;
}

// ALFERA_INSTALLER_ADDRESS and ALFERA_INSTALLER_SOURCE_ARCHIVE are for a test run that
// installs from a copy of the source. With neither set, the installer comes from the public
// repository.
function read_installer_source(environment = process.env) {
  const address = environment.ALFERA_INSTALLER_ADDRESS || default_installer_address;
  const archive = environment.ALFERA_INSTALLER_SOURCE_ARCHIVE || null;
  return {
    installer_address: require_shape(address, address_safe_in_a_command, 'The installer address'),
    source_archive: archive && require_shape(archive, address_safe_in_a_command, 'The source archive'),
  };
}

const check_server_command = '. /etc/os-release && echo "alfera-server-check $ID $VERSION_ID $(id -u)"';

// The key is not in this command. It goes to the installer on stdin.
function install_command({ https_name, installer_address, source_archive }) {
  require_shape(https_name, name_safe_in_a_command, 'The name of the server');
  const archive = source_archive ? `PRODUCT_SOURCE_ARCHIVE=${source_archive} ` : '';
  return (
    `curl -fsSL ${installer_address}/install.sh -o /root/install.sh && ` +
    `INSTALL_DIR=/opt/alfera ${archive}bash /root/install.sh ` +
    `--unattended --progress --answers-stdin --install-docker --https=${https_name}`
  );
}

// The folder is quoted, and it is a plain path: it holds no quote that could end the quoting.
function sign_in_link_command(install_dir) {
  if (!is_plain_folder(install_dir)) throw new Error('The folder of the install cannot be used in a command.');
  return `cd '${install_dir}' && ./alfera team link ${sign_in_link_minutes} --progress`;
}

// What the installer reads on stdin: the key under one name, and the installer works out whose
// key it is. No key gives no line: a server that has the key already needs none.
function answers_for_the_installer(key) {
  return key ? `MODEL_KEY=${key}\n` : '';
}

// The rows of the "Setting up" screen, in the order the installer works.
const progress_rows = [
  { title: 'Check the server', steps: ['tools'] },
  { title: 'Install Docker, the program Alfera runs in', steps: ['docker'] },
  { title: 'Download Alfera', steps: ['source'] },
  { title: 'Check your API key', steps: ['settings'] },
  { title: 'Build Alfera on the server', steps: ['api_image', 'app_image', 'images'] },
  { title: 'Start Alfera', steps: ['start'] },
  { title: 'Wait until Alfera answers', steps: ['api', 'dashboard'] },
  { title: 'Get the security certificate', steps: ['https'] },
];

// The one thing the person does next, for each reason the server stops. A reason that is not
// here, a new one, gets "try again".
const action_by_reason = {
  bad_arguments: 'try_again',
  state_folder_not_safe: 'new_server',
  install_running: 'try_again',
  install_interrupted: 'try_again',
  unsupported_machine: 'new_server',
  not_enough_memory: 'bigger_server',
  curl_missing: 'new_server',
  openssl_missing: 'new_server',
  git_missing: 'new_server',
  tar_missing: 'new_server',
  docker_not_installed: 'try_again',
  docker_not_running: 'try_again',
  docker_not_reachable: 'new_server',
  docker_install_failed: 'new_server',
  docker_compose_missing: 'new_server',
  docker_socket_unreadable: 'try_again',
  source_download_failed: 'try_again',
  model_key_missing: 'ask_for_key',
  model_key_refused: 'ask_for_key',
  setting_has_line_break: 'ask_for_key',
  own_model_name_missing: 'try_again',
  own_model_not_answering: 'try_again',
  database_from_earlier_install: 'new_server',
  https_name_not_usable: 'enter_address',
  own_domain_needed: 'enter_address',
  installed_with_other_address: 'enter_address',
  image_build_failed: 'try_again',
  image_pull_failed: 'try_again',
  port_in_use: 'new_server',
  no_free_address_range: 'new_server',
  stack_start_failed: 'try_again',
  api_did_not_answer: 'try_again',
  dashboard_did_not_answer: 'try_again',
  certificate_not_issued: 'try_again',
  version_not_published: 'try_again',
  registry_login_failed: 'try_again',
  public_address_not_stable: 'new_server',
  ssh_password_login_not_closed: 'new_server',
  setup_token_not_usable: 'new_server',
  backup_failed: 'try_again',
  update_rolled_back: 'try_again',
  update_failed: 'try_again',
  sign_in_link_not_made: 'try_again',
  unexpected: 'try_again',
  unlisted: 'try_again',
  not_installed: 'run_setup_again',
  served_over_https: 'open_server',
  sign_in_through_workos: 'open_server',
  address_missing: 'try_again',
  bad_address: 'enter_address',
  public_address_unknown: 'enter_address',
  bad_minutes: 'try_again',
};

// "Try again" runs the call that stopped again. The installer finishes a run that stopped,
// and changes nothing on a server that is already set up, so that is always safe.
const step_that_runs_a_call_again = { install: null, sign_in_link: 'signing_in' };
const moves_by_action = {
  try_again: (call) =>
    step_that_runs_a_call_again[call]
      ? { label: 'Try again', go_to: step_that_runs_a_call_again[call] }
      : { label: 'Try again', work: 'install_again' },
  run_setup_again: () => ({ label: 'Run the setup again', work: 'install_again' }),
  new_server: () => ({ label: 'Make a new server', go_to: 'make_server' }),
  bigger_server: () => ({ label: 'Make a bigger server', go_to: 'make_bigger_server' }),
  enter_address: () => ({ label: 'Change the address', go_to: 'server_address' }),
  open_server: () => ({ label: 'Open Alfera', work: 'open_without_sign_in_link' }),
};

// The installer writes its sentences for any program that runs it. Where one of them names a
// thing by another name than this app does, or sends the person to a place this app does not
// have, the app says it in its own words.
const words_of_the_app_by_reason = {
  not_enough_memory: 'This server has too little memory to build Alfera. Make a bigger server.',
  model_key_missing: 'The server did not get your API key. Paste your API key again.',
  model_key_refused: 'Anthropic or OpenAI refused that API key. Check your API key, then paste it again.',
  https_name_not_usable: 'The server could not work out its public address. Enter a domain name that points at the server.',
  public_address_unknown: 'The server could not work out its public address. Enter a domain name that points at the server.',
  own_domain_needed: 'This server signs people in with single sign-on, and that needs a domain name of your own. Point a domain name at the server, then enter that name.',
  sign_in_through_workos: 'Your server has a sign-in page of its own, so it needs no sign-in link.',
  unexpected: 'The setup stopped for a reason it did not expect. Try again. If it stops again, copy the log: it says where the setup stopped.',
};

const words_for_a_failure_with_no_sentence = 'The setup stopped. Try again. If it stops again, copy the log: it says where the setup stopped.';
const words_when_the_server_said_nothing = {
  connection_lost: 'The connection to your server was lost. Check your internet connection, then try again.',
  did_not_start: 'The setup could not start on your server. Check that the server can reach the internet, then try again.',
  stopped: 'The setup stopped and did not say why. Try again. If it stops again, copy the log: it says where the setup stopped.',
  // The server said it was done, with an address or a folder the app does not accept.
  answer_not_usable: words_for_a_failure_with_no_sentence,
  link_not_usable: 'Your server is set up, but its sign-in link could not be used. Try again.',
};

// The sign-in link needs the certificate of the name. Without one, the person looks at the
// address again: the name must point at the server.
const reasons_that_go_back_to_the_address = { sign_in_link: ['certificate_not_issued'] };

// A person who is signed out asks the server they set up for a new sign-in link. That is asked
// from one screen, and every way it can stop leads back to that same screen.
const words_when_the_server_gave_no_link = 'Your server gave no sign-in link. Check that the server is running, then try again.';
const ask_for_a_new_link_again = { label: 'Try again', work: 'get_sign_in_link_from_my_server' };

const read_sentence_for = (outcome) =>
  words_of_the_app_by_reason[outcome.reason] || outcome.message || words_for_a_failure_with_no_sentence;

// What the screen does after a call ended: the next step to show, or one sentence with one
// button. `call` is "install", "sign_in_link" (at the end of the setup) or "new_sign_in_link"
// (asked later, by a person who is signed out). A refused API key goes straight back to the
// screen that asks for it.
function read_next_move(outcome, call) {
  if (outcome.kind === 'done') {
    const sign_in_step = outcome.has_shared_name ? 'signing_in_on_a_shared_name' : 'signing_in';
    return { go_to: call === 'install' ? sign_in_step : null };
  }
  if (call === 'new_sign_in_link') {
    const problem = outcome.kind === 'failed' ? read_sentence_for(outcome) : words_when_the_server_gave_no_link;
    return { problem, action: ask_for_a_new_link_again };
  }
  if (outcome.kind !== 'failed') {
    return { problem: words_when_the_server_said_nothing[outcome.kind], action: moves_by_action.try_again(call) };
  }
  const problem = read_sentence_for(outcome);
  if (reasons_that_go_back_to_the_address[call]?.includes(outcome.reason)) {
    return { go_to: 'server_address', problem };
  }
  const action = action_by_reason[outcome.reason] ?? 'try_again';
  if (action === 'ask_for_key') return { go_to: 'api_key', problem };
  return { problem, action: moves_by_action[action](call) };
}

module.exports = {
  default_installer_address,
  usual_time_for_the_install,
  progress_rows,
  action_by_reason,
  words_of_the_app_by_reason,
  check_server_command,
  install_command,
  sign_in_link_command,
  answers_for_the_installer,
  read_installer_source,
  read_installed_server,
  is_sign_in_link_of,
  read_next_move,
};
