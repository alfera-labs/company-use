const { app, Menu, globalShortcut, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { create_folder_work } = require('./folder/folder_work.cjs');
const {
  is_invisible,
  keep_the_run_invisible,
  show_and_take_the_keyboard,
} = require('./invisible_run.cjs');
const { create_menu_bar_icon, draw_mark } = require('./menu_bar_icon.cjs');
const { read_app_menu } = require('./app_menu.cjs');
const { create_quick_ask } = require('./quick_ask/quick_ask.cjs');
const { watch_sessions } = require('./sessions.cjs');
const {
  read_settings,
  write_settings,
  read_address,
  has_chosen_an_address,
  keep_alfera_cloud_for_a_person_from_before,
  parse_web_address,
} = require('./settings.cjs');
const { create_setup_screen } = require('./setup/setup_screen.cjs');
const { is_sign_in_link_address } = require('./window/tab_pages.cjs');
const { create_tabbed_window } = require('./window/tabs.cjs');

const smoke_test = process.env.ALFERA_SMOKE === '1';
const quick_ask_shortcut = 'Alt+Space';
const exit_code_for_a_run_started_wrong = 64;

// A smoke run is a run by a script, and a run by a script shows nothing (invisible_run.cjs).
if (smoke_test && !is_invisible) {
  process.stderr.write('A smoke run must be invisible. Start it with: npm run smoke\n');
  process.exit(exit_code_for_a_run_started_wrong);
}
keep_the_run_invisible();

let tabs = null;
let quick_ask = null;
let sessions = null;
let is_quitting = false;
// Known only after Alfera was asked, as the signed-in person, at that address.
const folder_work_is_offered_at = new Map();

const folder_work = create_folder_work({
  read_settings,
  write_settings,
  read_address,
  read_window: () => tabs.window,
  read_page: () => tabs.front_page_in_use(),
});

function show_window() {
  if (tabs) show_and_take_the_keyboard(tabs.window);
}

// An invisible run allows nothing: a notification and the clipboard both reach the person.
function allow_notifications_from_alfera_only() {
  session.defaultSession.setPermissionRequestHandler((contents, permission, decide) => {
    const host = parse_web_address(contents?.getURL())?.host;
    const from_alfera = Boolean(host) && host === parse_web_address(read_address())?.host;
    const is_allowed = permission === 'notifications' || permission === 'clipboard-sanitized-write';
    decide(!is_invisible && from_alfera && is_allowed);
  });
}

// Closing the window keeps Alfera in the menu bar, so a chat can still tell the person it needs
// them. Quit ends it.
function keep_running_when_the_window_closes() {
  tabs.window.on('close', (event) => {
    if (is_quitting) return;
    event.preventDefault();
    tabs.window.hide();
  });
  app.on('before-quit', () => (is_quitting = true));
  app.on('activate', show_window);
}

// The first choice, and a choice of another server, open that server with no tab from before and
// no word about who was signed in. On the server the person is already on, a sign-in link signs
// them in, in the tab in front; any other page opens beside the tabs that are there.
function show_the_chosen_address(choice, address_before) {
  if (choice.address !== address_before) {
    tabs.forget_the_person();
    tabs.open_only_the_address(choice.first_page);
  } else if (is_sign_in_link_address(choice.first_page)) tabs.open_sign_in_link(choice.first_page);
  else if (choice.first_page !== `${choice.address}/`) tabs.open_page_beside_the_tabs(choice.first_page);
}

let setup = null;

// The menu changes with what the person can do: on the first run and while the setup shows,
// nothing that belongs to the tabs can be chosen, by the mouse or by a shortcut.
let menu_is_for_tabs_in_use = null;
function build_menu() {
  menu_is_for_tabs_in_use = tabs.is_in_use();
  const front_page = () => tabs.front_page_in_use();
  const template = read_app_menu({
    tabs_are_in_use: menu_is_for_tabs_in_use,
    offers_folder_work: Boolean(folder_work_is_offered_at.get(read_address())),
    actions: {
      change_address: () => setup.open(),
      work_in_a_folder: folder_work.choose_folder_and_work_in_it,
      stop_working_in_the_folder: folder_work.stop_working_in_the_folder,
      open_new_tab: () => tabs.open_new_chat_tab(),
      close_tab: () => tabs.close_tab(),
      ask_alfera: () => quick_ask.toggle(),
      reload: () => front_page()?.reload(),
      go_back: () => front_page()?.navigationHistory.goBack(),
      go_forward: () => front_page()?.navigationHistory.goForward(),
      show_actual_size: () => front_page()?.setZoomLevel(0),
      zoom_in: () => zoom_front_page(0.5),
      zoom_out: () => zoom_front_page(-0.5),
      show_next_tab: () => tabs.select_neighbour_tab(1),
      show_previous_tab: () => tabs.select_neighbour_tab(-1),
      show_tab_at: (index) => tabs.select_tab_at(index),
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function build_menu_when_what_can_be_done_changes() {
  if (tabs.is_in_use() !== menu_is_for_tabs_in_use) build_menu();
}

// Work in a folder needs routes that not every Alfera server has. The rows show only where
// the server offers them.
async function show_folder_work_where_alfera_offers_it() {
  const address = read_address();
  if (folder_work_is_offered_at.has(address)) return;
  const is_offered = await folder_work.ask_whether_alfera_offers_it();
  if (is_offered === null) return;
  folder_work_is_offered_at.set(address, is_offered);
  build_menu();
}

function zoom_front_page(step) {
  const page = tabs.front_page_in_use();
  page?.setZoomLevel(page.getZoomLevel() + step);
}

// One read of the person's chats feeds the tabs, the menu bar icon and the dock badge.
function show_chat_states_everywhere(menu_bar_icon) {
  sessions = watch_sessions({
    read_page: () => tabs.front_page(),
    // The chat list was read, so the person is signed in and Alfera can be asked what it offers.
    on_person: (person) => tabs.show_person(person),
    on_change: (states) => {
      tabs.show_session_states(states);
      menu_bar_icon.show_sessions(states);
      show_folder_work_where_alfera_offers_it().catch(() => {});
    },
  });
  // A tab that just opened a chat should show its state now, not at the next timer tick.
  tabs.on_change(() => sessions.read_now().catch(() => {}));
  tabs.on_change(build_menu_when_what_can_be_done_changes);
}

function resident_megabytes_of_the_whole_app() {
  const kilobytes = app
    .getAppMetrics()
    .reduce((sum, process_metric) => sum + process_metric.memory.workingSetSize, 0);
  return Math.round(kilobytes / 1024);
}

// A window that was never shown has no picture of its own, so each page draws one when asked.
async function take_picture_of(contents) {
  contents.debugger.attach('1.3');
  const { data } = await contents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
  contents.debugger.detach();
  return Buffer.from(data, 'base64');
}

// Before an address is chosen, and while the app asks for a sign-in link, the screen of the
// setup is the one to look at.
async function report_smoke_test() {
  await new Promise((resolve) =>
    setTimeout(resolve, Number(process.env.ALFERA_SMOKE_WAIT_MS ?? 5000)),
  );
  const front_page = tabs.front_page_in_use() ?? setup.read_page();
  const pictures = tabs.is_in_use()
    ? {
        strip: await take_picture_of(tabs.strip_page()),
        smoke: await take_picture_of(front_page),
        'menu-bar-icon': draw_mark().toPNG(),
      }
    : { 'first-run': await take_picture_of(front_page) };
  const screenshots = Object.entries(pictures).map(([name, picture]) => {
    const file = `/tmp/alfera-desktop-${name}.png`;
    fs.writeFileSync(file, picture);
    return file;
  });
  const report = {
    address: tabs.is_in_use() ? front_page.getURL() : null,
    title: front_page.getTitle(),
    tabs: tabs.count_tabs(),
    sleeping_tabs: tabs.count_sleeping_tabs(),
    resident_megabytes: resident_megabytes_of_the_whole_app(),
    screenshots,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  app.exit(0);
}

// ALFERA_FOLDER=/some/folder picks the folder without the dialog, for a scripted check.
function work_in_the_folder_named_on_the_command_line() {
  const folder = process.env.ALFERA_FOLDER;
  if (!folder) return;
  setTimeout(() => {
    folder_work.work_in_folder(folder).then(
      () => process.stdout.write(`${JSON.stringify({ working_in: folder })}\n`),
      (error) => process.stdout.write(`${JSON.stringify({ folder_error: error.message })}\n`),
    );
  }, 5000);
}

// Another app can hold the shortcut. Then macOS does not give it to this app, and the app does
// not show a shortcut that does nothing.
function register_quick_ask_shortcut() {
  const is_registered = !is_invisible && globalShortcut.register(quick_ask_shortcut, quick_ask.toggle);
  return is_registered ? quick_ask_shortcut : null;
}

// One window from the first moment. On the first run the setup fills it, and the same window
// becomes the app once the person has said where their Alfera is.
function start() {
  keep_alfera_cloud_for_a_person_from_before();
  allow_notifications_from_alfera_only();
  tabs = create_tabbed_window({
    on_front_page_asks: (asks) => setup.show_what_the_front_page_asks(asks),
  });
  setup = create_setup_screen({
    read_tabs: () => tabs,
    show_address: show_the_chosen_address,
    folder: path.join(app.getPath('userData'), 'server_setup'),
  });
  keep_running_when_the_window_closes();
  quick_ask = create_quick_ask({
    read_page: () => tabs.front_page_in_use(),
    is_in_use: tabs.is_in_use,
    is_signed_in: tabs.is_signed_in,
    open_chat: tabs.open_chat,
  });
  show_chat_states_everywhere(
    create_menu_bar_icon({
      open_chat: tabs.open_chat,
      open_quick_ask: quick_ask.toggle,
      show_window,
      quick_ask_shortcut: register_quick_ask_shortcut(),
    }),
  );
  build_menu();
  folder_work.resume_folder_work();
  work_in_the_folder_named_on_the_command_line();
  if (!has_chosen_an_address()) setup.open();
  if (smoke_test) report_smoke_test();
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', show_window);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(start);
} else {
  app.quit();
}
