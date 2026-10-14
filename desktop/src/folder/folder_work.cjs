const { dialog } = require('electron');
const path = require('node:path');
const { computer_name } = require('./folder_mcp_server.cjs');
const { ask_alfera_as_the_signed_in_person } = require('../alfera_api.cjs');
const { is_invisible } = require('../invisible_run.cjs');
const { listen_for_folder_messages } = require('./folder_relay.cjs');

const connect_tries = 5;

// "Work in a folder": the person picks one folder, and Alfera gets tools that read and write
// inside it. This file owns that one piece of state: which folder, and the open line to Alfera.
function create_folder_work({
  read_settings,
  write_settings,
  read_address,
  read_window,
  read_page,
}) {
  // Registering this computer and adding it to the workspace are the person's own actions, so
  // both go through the page with their sign-in. Everything after uses the computer's own token.
  const post_as_the_signed_in_person = (path, body = {}) =>
    ask_alfera_as_the_signed_in_person(read_page(), { method: 'POST', path, body });

  let listening = null;

  const read_folder = () => read_settings().folder ?? null;

  // One relay per Alfera address: the cloud and a self-hosted install each get their own.
  // The computer's token sits in the settings file, readable by this user only. The
  // macOS keychain would ask for a password after every update of an app Apple has not signed;
  // move the token there when the app is signed.
  const read_relay = () => read_settings().relays?.[read_address()] ?? null;

  const save_relay = (relay) => {
    write_settings({ relays: { ...read_settings().relays, [read_address()]: relay } });
  };

  const forget_relay = () => {
    const { [read_address()]: _forgotten, ...kept } = read_settings().relays ?? {};
    write_settings({ relays: kept });
  };

  // The line this computer listens on is a route of the install. An install without it answers
  // "not found" to the signed-in person. Asking reads nothing and changes nothing. Returns null
  // when no answer came, so the question can be asked again.
  async function ask_whether_alfera_offers_it() {
    const answer = await ask_alfera_as_the_signed_in_person(read_page(), {
      path: '/v1/mcp-relays/none/messages',
    });
    return answer.status === 0 ? null : answer.status !== 404;
  }

  async function register_this_computer() {
    const created = await post_as_the_signed_in_person('/v1/mcp-relays', {
      relay_name: computer_name(),
    });
    if (created.status !== 201)
      throw new Error(
        read_refusal(created, 'Sign in to Alfera first, then pick the folder again.'),
      );
    save_relay(created.body.data);
    return read_relay();
  }

  function start_listening(relay) {
    listening?.stop();
    listening = listen_for_folder_messages({
      relay,
      read_folder,
      // Alfera no longer knows this computer. The next folder pick registers it again.
      on_token_refused: forget_relay,
    });
  }

  // Alfera reads the tool list over the open line, so the line must be up first. The first tries
  // can arrive before it is.
  async function add_this_computer_to_the_workspace(relay) {
    let answer;
    for (let attempt = 0; attempt < connect_tries; attempt += 1) {
      answer = await post_as_the_signed_in_person(
        `/v1/mcp-relays/${relay.mcp_relay_id}/connection`,
      );
      if (answer.status === 200) return;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(read_refusal(answer, 'Alfera could not reach this computer.'));
  }

  async function work_in_folder(folder) {
    write_settings({ folder });
    const relay = read_relay() ?? (await register_this_computer());
    start_listening(relay);
    await add_this_computer_to_the_workspace(relay);
  }

  // It asks with a dialog and answers with one, so an invisible run does not do it.
  async function choose_folder_and_work_in_it() {
    if (is_invisible) return;
    const picked = await dialog.showOpenDialog(read_window(), {
      title: 'Work in a Folder',
      buttonLabel: 'Let Alfera Work Here',
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return;
    try {
      await work_in_folder(folder);
      dialog.showMessageBox(read_window(), {
        message: `Alfera can now work in “${path.basename(folder)}”.`,
        detail:
          'It reads files there without asking. It asks you before it changes a file or runs a command.',
      });
    } catch (error) {
      stop_working_in_the_folder();
      dialog.showMessageBox(read_window(), {
        type: 'warning',
        message: 'The folder is not connected.',
        detail: error.message,
      });
    }
  }

  function stop_working_in_the_folder() {
    listening?.stop();
    listening = null;
    write_settings({ folder: null });
  }

  // On launch, pick up where the person left off. No sign-in is needed: the computer has its own token.
  function resume_folder_work() {
    const relay = read_folder() ? read_relay() : null;
    if (relay) start_listening(relay);
  }

  return {
    read_folder,
    ask_whether_alfera_offers_it,
    work_in_folder,
    choose_folder_and_work_in_it,
    stop_working_in_the_folder,
    resume_folder_work,
  };
}

function read_refusal(answer, fallback) {
  return answer?.body?.error?.message ?? fallback;
}

module.exports = { create_folder_work };
