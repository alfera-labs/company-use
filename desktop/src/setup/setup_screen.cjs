const { WebContentsView, ipcMain, nativeTheme, net } = require('electron');
const path = require('node:path');
const { clipboard, open_outside_the_app, take_the_keyboard } = require('../invisible_run.cjs');
const {
  choose_address,
  default_address,
  has_chosen_an_address,
  read_address,
} = require('../settings.cjs');
const { is_sign_in_link_address } = require('../window/tab_pages.cjs');
const { find_address_problem, parse_address_choice } = require('./address_choice.cjs');
const { open_deploy_view } = require('./deploy_view.cjs');
const { read_installer_source, read_next_move } = require('./installer_contract.cjs');
const { make_server_for_me } = require('./make_server_for_me.cjs');
const { create_server_setup } = require('./server_setup.cjs');
const { setup_provider } = require('./setup_provider.js');

const words_for_no_web_address = 'That is not a web address. A web address looks like alfera.example.com.';
const words_for_no_sign_in_link = 'That is not a sign-in link. A sign-in link has /join/ in it.';
const words_for_a_link_that_did_not_work = 'That sign-in link is used up or not valid. Paste a new sign-in link.';
const words_for_no_key = 'Paste your API key first.';
const words_for_a_key_with_a_space = 'An API key is one line with no spaces. Paste it again.';
const words_for_a_server_the_app_did_not_set_up = 'This app did not set up that server, so it cannot ask it for a sign-in link.';
const words_for_a_deploy_page_that_does_not_open = 'The setup page does not open. Check that this Mac is online, then try again.';
// Long enough to read the one line about the address before the app opens.
const milliseconds_to_read_a_note = 6000;
// The setup stays over the app until the first page of the app has loaded under it, so the
// person never looks at an empty window. A page that does not load is not waited for longer.
const most_milliseconds_to_wait_for_the_app = 5000;
const seconds_to_wait_for_the_installer = 3;

// The screen the app shows by itself when the page in front asks for a sign-in link, or was
// given one that is used up. A web page cannot take a link in this app: there is no address bar.
// A sign-in page of the server itself has its own buttons, and gets no screen.
const screen_by_what_a_page_asks = {
  sign_in_link: { step: 'sign_in_link' },
  new_sign_in_link: { step: 'sign_in_link', problem: words_for_a_link_that_did_not_work },
};

// The screens where the person says where their Alfera is. They fill the window of the app,
// under the strip: on the first run, when the person changes the address later, and when a
// server asks for a sign-in link. When the setup ends, the same window shows the app. The
// screens are the step records in setup_steps.js; the work those steps name is in work_by_name.
function create_setup_screen({ read_tabs, show_address, folder }) {
  let view = null;
  let last_progress = null;
  let first_screen = null;
  let work_under_way = 0;
  let forget_to_close = () => {};
  let installer_answers = false;
  let server_being_made = new AbortController();
  let deploy_view = null;
  const addresses_given_up = new Set();
  const moves_to_a_new_server = ['make_server', 'make_bigger_server'];

  const show_progress = () => {
    if (view && last_progress) view.webContents.send('setup:progress', last_progress);
  };
  const server_setup = create_server_setup({
    folder,
    tell_progress: (progress) => {
      last_progress = progress;
      show_progress();
    },
  });

  // The guided setup downloads the installer to the server. When the place it comes from does
  // not answer, the setup cannot work, and the first screen does not offer it. A yes is kept;
  // a no is asked again the next time a screen opens.
  async function ask_whether_the_installer_answers() {
    if (installer_answers) return true;
    try {
      const answer = await net.fetch(`${read_installer_source().installer_address}/install.sh`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(seconds_to_wait_for_the_installer * 1000),
      });
      installer_answers = answer.ok;
    } catch {
      installer_answers = false;
    }
    return installer_answers;
  }

  // A person who uses a server of their own starts at its address, which they can then change.
  function read_first_screen() {
    if (first_screen) return first_screen;
    const uses_own_server = has_chosen_an_address() && read_address() !== default_address;
    return uses_own_server ? { step: 'own_server', field_text: read_address() } : { step: 'where' };
  }

  function close_the_deploy_page() {
    deploy_view?.close();
    deploy_view = null;
  }

  async function open_the_deploy_page() {
    close_the_deploy_page();
    const opened = open_deploy_view({
      over: view,
      on_new_server: use_address,
      on_leave: () => show_screen({ step: 'where' }),
    });
    deploy_view = opened;
    if ((await opened.loaded) || opened !== deploy_view) return;
    close_the_deploy_page();
    return { problem: words_for_a_deploy_page_that_does_not_open };
  }

  function show_screen(wanted) {
    forget_to_close();
    close_the_deploy_page();
    if (view) {
      view.webContents.send('setup:show', wanted);
      return take_the_keyboard(view.webContents);
    }
    first_screen = wanted;
    view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'setup_preload.cjs'),
      },
    });
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#202026' : '#fbfaf9');
    view.webContents.loadFile(path.join(__dirname, 'setup.html'));
    read_tabs().cover_the_tabs(view);
    take_the_keyboard(view.webContents);
  }

  // "Change Address…". When the setup is already open, it goes to the first screen: that is the
  // way out of every screen, also of one that waits for a server. The connection to that server
  // ends; an install that is under way on it goes on.
  function open() {
    if (view) stop_the_server_setup();
    show_screen(view ? { step: 'where' } : null);
  }

  // The page in front asks for a sign-in link. A step that is at work is not taken away: when
  // it ends, `close` looks at the page again.
  function show_what_the_front_page_asks(asks) {
    const wanted = screen_by_what_a_page_asks[asks];
    if (wanted && work_under_way === 0) show_screen(wanted);
  }

  // The connection to a server ends with the setup, and the API key goes with it. An install
  // that is under way on the server goes on. The setup does not close over a page that asks for
  // a sign-in link: that page has nothing to press, so the screen for the link takes its place.
  function close() {
    if (!view) return;
    forget_to_close();
    close_the_deploy_page();
    stop_the_server_setup();
    server_setup.forget_the_key();
    const wanted = screen_by_what_a_page_asks[read_tabs().read_what_front_page_asks()];
    if (wanted) return show_screen(wanted);
    read_tabs().uncover_the_tabs();
    view.webContents.close();
    view = null;
    first_screen = null;
  }

  function close_when_the_app_has_loaded() {
    const page = read_tabs().front_page();
    if (!page?.isLoading()) return close();
    const timer = setTimeout(close, most_milliseconds_to_wait_for_the_app);
    page.once('did-stop-loading', close);
    forget_to_close = () => {
      clearTimeout(timer);
      if (!page.isDestroyed()) page.removeListener('did-stop-loading', close);
      forget_to_close = () => {};
    };
  }

  function use_address(choice) {
    const address_before = has_chosen_an_address() ? read_address() : null;
    choose_address(choice.address);
    show_address(choice, address_before);
    close_when_the_app_has_loaded();
  }

  async function use_server_that_answers(choice) {
    const problem =
      choice.address === default_address
        ? null
        : await find_address_problem(choice.address, net.fetch);
    if (problem) return { problem };
    use_address(choice);
  }

  // The server is set up. Its sign-in link, when there is one, is the first page the app opens.
  // The link goes to the tab and is kept nowhere else. Both were checked when they came in:
  // the address is the server the app connected to, and the link is a link of that address.
  function open_installed_server(sign_in_link) {
    const { address } = server_setup.read_installed();
    use_address({ address, first_page: sign_in_link ?? `${address}/` });
  }

  async function sign_in_to_the_server(call) {
    const outcome = await server_setup.read_sign_in_link();
    if (outcome.kind !== 'done') return with_log(read_next_move(outcome, call));
    return open_installed_server(outcome.link);
  }

  const with_log = (move) => ({ ...move, has_log: Boolean(move.problem) });

  function stop_the_server_setup() {
    server_setup.stop();
    server_being_made.abort();
    server_being_made = new AbortController();
  }

  function go_on_with_the_server() {
    const needs_the_key = !server_setup.holds_a_key() && !server_setup.server_has_the_key();
    if (needs_the_key) return { go_to: 'api_key' };
    server_setup.start_install();
    return { go_to: 'setting_up' };
  }

  async function make_server_of_size(size) {
    const outcome = await make_server_for_me({
      server_setup,
      size,
      addresses_given_up: [...addresses_given_up],
      open_in_browser: open_outside_the_app,
      signal: server_being_made.signal,
    });
    return outcome.problem ? { problem: outcome.problem } : go_on_with_the_server();
  }

  // The work a step can name. Each returns nothing when the setup is finished, { go_to } with
  // the step to show next, { text } to show, or { problem } with one sentence for the person
  // and, at most, one { action }.
  const work_by_name = {
    use_alfera_cloud: () => use_address(parse_address_choice(default_address)),
    open_deploy_page: open_the_deploy_page,
    use_own_server: (text) => {
      const choice = parse_address_choice(text);
      return choice ? use_server_that_answers(choice) : { problem: words_for_no_web_address };
    },
    open_sign_in_link: (text) => {
      const choice = parse_address_choice(text);
      const is_a_link = choice && is_sign_in_link_address(choice.first_page);
      return is_a_link ? use_server_that_answers(choice) : { problem: words_for_no_sign_in_link };
    },
    // Only for a server this app set up: the app has the SSH key for it, and asks it for a link.
    get_sign_in_link_from_my_server: () => {
      if (!server_setup.use_server_set_up_at(read_address())) {
        return { problem: words_for_a_server_the_app_did_not_set_up };
      }
      return sign_in_to_the_server('new_sign_in_link');
    },
    make_key_pair: async () => ({ text: await server_setup.read_public_key() }),
    make_server: () => make_server_of_size(setup_provider.size_id),
    make_bigger_server: () => make_server_of_size(setup_provider.bigger_size_id),
    stop_making_server: () => (stop_the_server_setup(), {}),
    check_server: async (text) => {
      const outcome = await server_setup.check_server(text);
      return outcome.problem ? { problem: outcome.problem } : go_on_with_the_server();
    },
    start_install: (text) => {
      const key = String(text).trim();
      if (!key) return { problem: words_for_no_key };
      if (/\s/.test(key)) return { problem: words_for_a_key_with_a_space };
      server_setup.start_install(key);
      return { go_to: 'setting_up' };
    },
    install_again: () => {
      server_setup.start_install();
      return { go_to: 'setting_up' };
    },
    // An API key the installer refused, or says it never got, is typed again.
    wait_for_install: async () => {
      show_progress();
      const move = read_next_move(await server_setup.wait_for_install(), 'install');
      if (move.go_to === 'api_key') server_setup.forget_the_key();
      if (moves_to_a_new_server.includes(move.action?.go_to)) addresses_given_up.add(server_setup.read_host());
      return with_log(move);
    },
    open_my_server: () => sign_in_to_the_server('sign_in_link'),
    open_my_server_after_the_note: async () => {
      await new Promise((resolve) => setTimeout(resolve, milliseconds_to_read_a_note));
      return sign_in_to_the_server('sign_in_link');
    },
    open_without_sign_in_link: () => open_installed_server(null),
  };

  const texts_to_copy = {
    public_key: () => server_setup.read_public_key(),
    log: () => server_setup.read_log(),
  };

  // What a step can depend on. The first screen waits for the answer about the installer, so
  // the row of the guided setup does not come and go in front of the person.
  ipcMain.handle('setup:read', async () => ({
    address: has_chosen_an_address() ? read_address() : null,
    default_address,
    first_screen: read_first_screen(),
    installer_is_available: await ask_whether_the_installer_answers(),
    app_set_up_this_server: has_chosen_an_address() && server_setup.set_up_the_server_at(read_address()),
  }));
  // The person leaves the setup without a choice. On the first run there is nothing to leave to.
  ipcMain.handle('setup:leave', () => {
    if (has_chosen_an_address()) close();
  });
  ipcMain.handle('setup:run', async (_event, work, input) => {
    if (!Object.hasOwn(work_by_name, work)) throw new Error(`No setup work is named ${work}`);
    work_under_way += 1;
    try {
      return (await work_by_name[work](input)) ?? {};
    } finally {
      work_under_way -= 1;
    }
  });
  // Answers with the text it copied. Neither text holds a secret: the public half of a key
  // pair, and the log, which is kept free of the API key and of sign-in links.
  ipcMain.handle('setup:copy', async (_event, name) => {
    if (!Object.hasOwn(texts_to_copy, name)) throw new Error(`No text to copy is named ${name}`);
    const text = await texts_to_copy[name]();
    clipboard().writeText(text);
    return text;
  });

  return { open, show_what_the_front_page_asks, read_page: () => view?.webContents ?? null };
}

module.exports = { create_setup_screen };
