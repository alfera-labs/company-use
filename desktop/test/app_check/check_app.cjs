// `npm run check-app`: drives the real app in each state it can be in, and in each one chooses
// every row of every menu, presses what the strip offers, and asks through the quick-ask bar.
// The app must never throw, and in each state only the things that belong there may do anything.
// The states: the first run, the setup, signed out (a server that wants a sign-in link, and a
// server with a sign-in page of its own), signed in with no tab, one tab and many tabs, tabs
// from the last time, and a server that is away, answers with an error, or does not answer.
// The Alfera server is a stand-in on this Mac (stand_in_alfera.cjs). Nothing reaches the person
// at the Mac: no window shows and nothing takes the keyboard. Each run asks the app and macOS
// whether that holds. Without ALFERA_INVISIBLE=1 the check does not start.
//   ALFERA_INVISIBLE=1 node test/app_check/check_app.cjs [name of one run]
const { stop_unless_the_run_is_invisible } = require('../invisible_electron.cjs');
stop_unless_the_run_is_invisible('The app check');
const { start_hidden_app, wait, is_strip, is_setup, is_bar } = require('./hidden_app.cjs');
const { start_stand_in_alfera } = require('./stand_in_alfera.cjs');

class WrongState extends Error {}
class SomethingShowed extends Error {}

function check(is_right, what, seen = '') {
  if (!is_right) throw new WrongState(`${what}${seen === '' ? '' : `\n      seen: ${JSON.stringify(seen)}`}`);
}

async function until(read, is_it, what, seconds = 15) {
  let seen;
  for (let waited = 0; waited < seconds * 10; waited += 1) {
    seen = await read().catch((error) => ({ could_not_read: error.message }));
    if (seen && !seen.could_not_read && is_it(seen)) return seen;
    await wait(100);
  }
  throw new WrongState(`${what}: not seen in ${seconds} seconds\n      seen: ${JSON.stringify(seen)}`);
}

// ---- what the check reads ---------------------------------------------------------------------

const read_strip = (app) =>
  app.in_page(is_strip, `(() => {
    const box = (element) => { const { left, width } = element.getBoundingClientRect(); return { left: Math.round(left), width: Math.round(width) }; };
    const dim = getComputedStyle(document.querySelector('.dim') ?? document.createElement('div'));
    return {
      tabs: [...document.querySelectorAll('.tab')].map((tab) => ({ name: tab.querySelector('.name').textContent, in_front: tab.classList.contains('front'), mark: tab.querySelector('.state').dataset.state ?? null, ...box(tab) })),
      band: box(document.querySelector('.above-sidebar')).width,
      new_tab_button: box(document.getElementById('new')),
      is_covered: document.body.classList.contains('covered'),
      color: getComputedStyle(document.body).backgroundColor,
      dim: { color: dim.backgroundColor || 'rgba(0, 0, 0, 0)', share: Number(dim.opacity) },
      window_width: innerWidth,
    };
  })()`);

const read_setup = (app) =>
  app.in_page(is_setup, `(() => {
    const screen = document.querySelector('main');
    const texts = (selector) => [...screen.querySelectorAll(selector)].map((element) => element.textContent);
    return { step: screen.dataset.step, state: screen.dataset.state, problems: texts('.problem:not(:empty)'), buttons: texts('button'), words: texts('h2, section p'), field: screen.querySelector('input')?.value ?? null };
  })()`).catch(() => ({ step: null }));

const read_front_address = (app) => app.in_main('front_tab_page()?.getURL() ?? null');
const read_names = (strip) => strip.tabs.map((tab) => tab.name);
const read_rows = (app) => app.in_main('rows_of_the_menus().map((row) => ({ label: row.label, can_be_chosen: row.enabled }))');

const see_step = (app, step, state = 'idle') => until(() => read_setup(app), (screen) => screen.step === step && screen.state === state, `the setup shows "${step}", ${state}`);
const see_no_setup = (app) => until(() => read_setup(app), (screen) => screen.step === null, 'the setup is gone');
const see_tabs = (app, count, what) => until(() => read_strip(app), (strip) => strip.tabs.length === count && !strip.is_covered, what ?? `the strip shows ${count} tabs`);

// ---- what the check does ----------------------------------------------------------------------

// The menu is built again when the state changes, so a row is found by its name each time.
const choose = (app, label) => app.in_main(`(() => { const row = rows_of_the_menus().find((candidate) => candidate.label === ${JSON.stringify(label)}); if (!row) return false; row.click(); return true; })()`);

// Chooses every row that the app itself answers, also the ones that cannot be chosen: a shortcut
// of a row that cannot be chosen does nothing, and its handler must do nothing either.
async function choose_every_row(app, { but = ['Change Address…'] } = {}) {
  const rows = await read_rows(app);
  for (const row of rows.filter((candidate) => !but.includes(candidate.label))) {
    await choose(app, row.label);
    await wait(120);
  }
  return rows;
}

// What the strip can send, sent as the strip sends it.
const press_everything_in_the_strip = (app) => app.in_page(is_strip, 'alfera_tabs.open_new(); alfera_tabs.select(1); alfera_tabs.select(999); alfera_tabs.close(999); true');
const select_tab = (app, place) => app.in_page(is_strip, `document.querySelectorAll('.tab')[${place}].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); true`);
const type_in_setup = (app, text) => app.in_page(is_setup, `document.querySelector('input').value = ${JSON.stringify(text)}; true`);
const press_in_setup = (app, label) =>
  app.in_page(is_setup, `(() => { const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === ${JSON.stringify(label)}); if (!button || button.disabled) return false; setTimeout(() => button.click(), 30); return true; })()`)
    .then((pressed) => check(pressed, `the button "${label}" is there to press`));
const press_escape_in_setup = (app) => app.in_page(is_setup, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
const click_in_front_tab = (app, selector, with_command_key = false) =>
  app.in_front_tab(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: ${with_command_key} })); true`);

// A page that is never on the screen draws no frame by itself, and a new zoom takes hold with
// the next frame. Asking the page for a small picture makes it draw one.
const draw_a_frame_of_the_front_tab = (app) =>
  app.in_main(`(async () => { const page = front_tab_page(); page.debugger.attach('1.3'); await page.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 1 }); page.debugger.detach(); return true; })()`);

// The quick-ask bar, as a person uses it: text in the field, then Return.
const ask_through_the_bar = (app, question) =>
  app.in_page(is_bar, `(() => { const field = document.getElementById('question'); field.value = ${JSON.stringify(question)}; field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
const read_bar = (app) => app.in_page(is_bar, `({ question: document.getElementById('question').value, note: document.getElementById('note').textContent, waits: document.getElementById('question').disabled })`);

// The rule of every run. When it is broken the app is ended before anything else.
async function see_that_nothing_shows(app, when) {
  const says = await app.in_main(`({ windows_that_show: electron.BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length, a_window_has_the_keyboard: electron.BrowserWindow.getFocusedWindow() !== null, dock_icon_shows: electron.app.dock.isVisible() })`);
  const macos = app.read_what_macos_says();
  const nothing_shows = says.windows_that_show === 0 && !says.a_window_has_the_keyboard && !says.dock_icon_shows && !macos.is_in_front && macos.kind !== '"ApplicationType"="Foreground"';
  if (nothing_shows) return;
  app.end_now();
  throw new SomethingShowed(`${when}: the app is not invisible\n      ${JSON.stringify({ ...says, ...macos })}`);
}

function see_that_the_app_never_threw(app) {
  check(app.read_exit_code() === null, 'the app still runs', { exit_code: app.read_exit_code(), errors: app.read_errors().slice(-1500) });
  check(!app.read_errors().includes('The app threw'), 'the app did not throw', app.read_errors().slice(-1500));
}

const rows_that_can_be_chosen = (rows) => rows.filter((row) => row.can_be_chosen).map((row) => row.label);
const web_pages_of = (app) => app.in_main(`electron.webContents.getAllWebContents().map((contents) => contents.getURL()).filter((address) => address.startsWith('http'))`);

// ---- the runs ---------------------------------------------------------------------------------

const runs = {
  // Nothing but the setup may do anything before the person has said where their Alfera is.
  first_run_and_setup: async ({ start, server }) => {
    const app = await start({});
    const first = await see_step(app, 'where');
    check(first.buttons.includes('I will do it myself'), 'the installer answers, so the guided setup by hand is offered', first.buttons);
    const rows = await choose_every_row(app);
    check(rows_that_can_be_chosen(rows).join() === 'Change Address…', 'on the first run only "Change Address…" can be chosen', rows_that_can_be_chosen(rows));
    await press_everything_in_the_strip(app);
    await ask_through_the_bar(app, 'A question before any address');
    await wait(800);
    see_that_the_app_never_threw(app);
    check((await read_setup(app)).step === 'where', 'the first screen still shows', await read_setup(app));
    check(Object.keys(app.read_settings()).every((name) => !['address', 'tabs'].includes(name)), 'no address and no tab was written down', app.read_settings());
    check((await web_pages_of(app)).length === 0, 'no page of any server was opened', await web_pages_of(app));
    check((await read_strip(app)).tabs.length === 0, 'the strip shows no tab');

    await press_in_setup(app, 'I will do it myself');
    await see_step(app, 'what_you_need');
    await choose_every_row(app);
    await press_everything_in_the_strip(app);
    await wait(400);
    check((await read_setup(app)).step === 'what_you_need', 'the screen of the setup stays', await read_setup(app));
    check(app.read_settings().address === undefined, 'no address was written down in the setup');
    await choose(app, 'Change Address…');
    await see_step(app, 'where');

    // A server that signs people in with a link: the app asks for the link on a screen of its own.
    server.read_state().sign_in = 'link';
    await press_in_setup(app, 'I already have an Alfera server');
    await see_step(app, 'own_server');
    await type_in_setup(app, server.address);
    await press_in_setup(app, 'Open');
    const asks = await see_step(app, 'sign_in_link');
    check(asks.buttons.includes('Back') && asks.buttons.includes('Sign in'), 'the screen has a way back and one button', asks.buttons);
    check(!asks.buttons.includes('Get a new sign-in link from my server'), 'this app did not set that server up, so it offers no link from it', asks.buttons);
    await wait(1200);
    const colors = { strip: (await read_strip(app)).color, screen: await app.in_page(is_setup, 'getComputedStyle(document.body).backgroundColor') };
    check(colors.strip === colors.screen, 'the strip has the colour of the screen under it, not of the page that was refused', colors);
    check(rows_that_can_be_chosen(await choose_every_row(app)).join() === 'Change Address…', 'while the app asks for a link, only "Change Address…" can be chosen');
    await press_escape_in_setup(app);
    await see_step(app, 'where');
    await press_escape_in_setup(app);
    await see_step(app, 'sign_in_link');

    await type_in_setup(app, 'not a link');
    await press_in_setup(app, 'Sign in');
    check((await see_step(app, 'sign_in_link', 'failed')).problems[0] === 'That is not a sign-in link. A sign-in link has /join/ in it.', 'text that is no link gets one sentence');
    const used_up = server.make_sign_in_link();
    server.read_state().links_that_work.delete(used_up.token);
    await type_in_setup(app, used_up.link);
    await press_in_setup(app, 'Sign in');
    const refused = await until(() => read_setup(app), (screen) => screen.step === 'sign_in_link' && screen.problems[0]?.startsWith('That sign-in link is used up'), 'a link that is used up is said in one sentence');
    check(refused.problems[0] === 'That sign-in link is used up or not valid. Paste a new sign-in link.', 'the sentence for a link that is used up', refused.problems);

    const fresh = server.make_sign_in_link();
    await type_in_setup(app, fresh.link);
    await press_in_setup(app, 'Sign in');
    await see_no_setup(app);
    const strip = await see_tabs(app, 1, 'signed in: the strip shows the one tab');
    check(strip.tabs[0].name === 'New chat', 'the tab has its name', read_names(strip));
    const kept = JSON.stringify(app.read_settings());
    check(!kept.includes(used_up.token) && !kept.includes(fresh.token) && !kept.includes('/join/'), 'no sign-in link is written down', kept);
    check(app.read_settings().address === server.address, 'the address of the server is written down', app.read_settings().address);
    return app;
  },

  // The guided setup by hand is offered only when its installer answers.
  installer_does_not_answer: async ({ start, server }) => {
    const app = await start({ environment: { ALFERA_INSTALLER_ADDRESS: `${server.address}/api/no-installer-here` } });
    const first = await see_step(app, 'where');
    check(!first.buttons.includes('I will do it myself'), 'the guided setup by hand has no link', first.buttons);
    check(first.buttons.includes('Set it up'), 'the deploy page needs no installer, so its button is there', first.buttons);
    check(first.buttons.includes('Use Alfera Cloud') && first.buttons.includes('I already have an Alfera server'), 'the other two choices are there', first.buttons);
    return app;
  },

  // An address that is no address: the tabs are in use and there is no tab at all.
  signed_in_with_no_tab: async ({ start }) => {
    const app = await start({ environment: { ALFERA_ADDRESS: 'not an address' } });
    await until(() => read_strip(app), (strip) => !strip.is_covered, 'the strip is there');
    await wait(600);
    const rows = await choose_every_row(app, { but: [] });
    check(rows.length >= 19, 'every row was chosen', rows.length);
    await press_everything_in_the_strip(app);
    await ask_through_the_bar(app, 'A question with no tab');
    await wait(600);
    see_that_the_app_never_threw(app);
    return app;
  },

  signed_in_with_one_tab_and_with_many: async ({ start, server }) => {
    server.read_state().offers_folder_work = true;
    const app = await start({ settings: { address: server.address } });
    const one = await until(() => read_strip(app), (strip) => strip.tabs.length === 1 && strip.band === 248, 'one tab, and a band as wide as the sidebar');
    check(one.tabs[0].name === 'New chat', 'the tab has its name', one.tabs);
    await until(() => read_rows(app), (rows) => rows.some((row) => row.label === 'Work in a Folder…'), 'the server offers work in a folder, so its rows show');
    const rows = await choose_every_row(app);
    check(rows.every((row) => row.can_be_chosen), 'signed in, every row can be chosen', rows.filter((row) => !row.can_be_chosen));
    await wait(500);
    see_that_the_app_never_threw(app);
    check((await read_strip(app)).tabs.length >= 1, 'a tab is still there after every row was chosen');

    // A plain click stays in its tab. A click with the Command key opens a new tab.
    const before = (await read_strip(app)).tabs.length;
    await click_in_front_tab(app, 'a[href="/inbox"]');
    await until(() => read_front_address(app), (address) => address === `${server.address}/inbox`, 'a plain click on a link goes there in the same tab');
    check((await read_strip(app)).tabs.length === before, 'a plain click opens no tab', (await read_strip(app)).tabs.length);
    for (const path of ['/chats/ses_aaa1', '/chats/ses_bbb2', '/scheduled-tasks', '/projects', '/chats/ses_ccc3']) {
      const count = (await read_strip(app)).tabs.length;
      await click_in_front_tab(app, `a[href="${path}"]`, true);
      await see_tabs(app, count + 1, `a click with the Command key on ${path} opens a tab`);
    }
    const count = (await read_strip(app)).tabs.length;
    await click_in_front_tab(app, '#opens_a_window');
    const many = await until(() => read_strip(app), (strip) => strip.tabs.length === count + 1 && strip.tabs.every((tab) => tab.mark !== 'loading'), 'a link that asks for a window of its own gets a tab');

    // No name moves a tab: every tab has one width, and the "+" stays where it is.
    check(new Set(many.tabs.map((tab) => tab.width)).size === 1, 'every tab has the same width', many.tabs.map((tab) => tab.width));
    check(many.new_tab_button.left + many.new_tab_button.width <= many.window_width - 8, 'the "+" is clear of the edge of the window', many.new_tab_button);
    const places = (strip) => JSON.stringify([strip.tabs.map((tab) => [tab.left, tab.width]), strip.new_tab_button.left]);
    for (const path of ['/inbox', '/scheduled-tasks', '/projects', '/chats/ses_bbb2']) {
      await click_in_front_tab(app, `a[href="${path}"]`);
      await until(() => read_front_address(app), (address) => address === `${server.address}${path}`, `the tab in front goes to ${path}`);
      await wait(250);
      const now = await read_strip(app);
      check(places(now) === places(many), `no tab and no button moved when the tab in front went to ${path}`, { before: places(many), now: places(now) });
    }
    const names = read_names(await read_strip(app));
    check(names.includes('Plan the week') && names.includes('Scheduled tasks') && names.includes('Projects'), 'chats and other pages have their names', names);
    check(!names.includes('Chats') && !names.includes('Alfera') && !names.includes('Untitled session'), 'no tab has the name of the product or of a list', names);

    await choose_every_row(app);
    await wait(500);
    see_that_the_app_never_threw(app);

    // A dialog dims the page, and the strip with it.
    await app.in_front_tab('dim_the_page(true); true');
    const dimmed = await until(() => read_strip(app), (strip) => strip.dim.share > 0, 'the strip is dimmed with the page');
    check(dimmed.dim.color === 'rgba(0, 0, 0, 0.3)', 'the strip takes the colour of the layer over the page', dimmed.dim);
    await app.in_front_tab('dim_the_page(false); true');
    await until(() => read_strip(app), (strip) => strip.dim.color === 'rgba(0, 0, 0, 0)', 'the strip is clear again with the page');

    // The band over the sidebar follows the zoom of the page.
    await choose(app, 'Actual Size');
    await until(() => read_strip(app), (strip) => strip.band === 248, 'at its own size the band is as wide as the sidebar');
    await choose(app, 'Zoom In');
    await choose(app, 'Zoom In');
    await draw_a_frame_of_the_front_tab(app);
    const zoomed = await until(() => read_strip(app), (strip) => strip.band > 248, 'the band grows with the page');
    const sidebar_on_screen = await app.in_main(`front_tab_page().executeJavaScript('document.querySelector("aside").getBoundingClientRect().right').then((right) => Math.round(right * front_tab_page().getZoomFactor()))`);
    check(Math.abs(zoomed.band - sidebar_on_screen) <= 1, 'the band is as wide as the sidebar is on the screen', { band: zoomed.band, sidebar_on_screen });
    await choose(app, 'Actual Size');

    // "New Tab" brings the window up: a new tab in a closed window is a tab nobody sees.
    const wanted_before = await app.in_main('invisible_run.titles_of_windows_the_app_wanted_to_show.length');
    await choose(app, 'New Tab');
    const wanted_after = await app.in_main('invisible_run.titles_of_windows_the_app_wanted_to_show.slice()');
    check(wanted_after.length > wanted_before && wanted_after.at(-1) === 'Alfera', '"New Tab" asks for the window of the app to show', wanted_after);

    // "Change Address…" opens the setup over the tabs, and Escape leaves it again.
    await choose(app, 'Change Address…');
    const own = await see_step(app, 'own_server');
    check(own.field === server.address, 'the setup starts at the address in use', own.field);
    check(rows_that_can_be_chosen(await read_rows(app)).join() === 'Change Address…', 'while the setup shows, only "Change Address…" can be chosen');
    await choose_every_row(app);
    await choose(app, 'Change Address…');
    await see_step(app, 'where');
    await press_escape_in_setup(app);
    await see_no_setup(app);
    check((await read_strip(app)).tabs.length >= 2, 'the tabs are back', (await read_strip(app)).tabs.length);
    return app;
  },

  // Tabs from the last time start asleep. Each has its name before it has a page, an address
  // from an older version loses its sign-in link, and a page of the app itself is not a tab.
  tabs_from_the_last_time: async ({ start, server }) => {
    const old_token = 'token-from-an-older-version-0001';
    const saved = ['/chats/ses_aaa1', '/inbox', `/join/${old_token}`, '/scheduled-tasks/abc', '/chats/ses_bbb2'].map((path) => `${server.address}${path}`);
    const app = await start({ settings: { address: server.address, person: 'user_stand_in_1', front_tab: 0, tabs: [...saved, 'file:///somewhere/unreachable.html?address=x'] } });
    const strip = await until(() => read_strip(app), (now) => now.tabs.length === 5 && now.tabs[4].name !== '', 'the five tabs from the last time, each with a name');
    check(JSON.stringify(read_names(strip)) === JSON.stringify(['Plan the week', 'Inbox', 'New chat', 'Scheduled tasks', 'A report with a long name that does not fit in a tab']), 'each tab has its name before it has a page', read_names(strip));
    check(!JSON.stringify(app.read_settings()).includes(old_token), 'the sign-in link from the older version is gone from the settings', app.read_settings().tabs);
    await choose_every_row(app);
    for (const place of [4, 3, 2, 1, 0]) {
      const now = await read_strip(app);
      if (place >= now.tabs.length) continue;
      await select_tab(app, place);
      await until(() => read_front_address(app), (address) => address?.startsWith(server.address), `tab ${place + 1} wakes on a page of the server`);
    }
    see_that_the_app_never_threw(app);
    return app;
  },

  // The person is signed out while tabs are open, and signs in again. Every earlier tab must
  // come back on its own page.
  signs_out_and_in_again: async ({ start, server }) => {
    const paths = ['/chats/ses_aaa1', '/inbox', '/scheduled-tasks', '/chats/ses_bbb2'];
    const app = await start({ settings: { address: server.address, person: 'user_stand_in_1', front_tab: 0, tabs: paths.map((path) => `${server.address}${path}`) } });
    await until(() => read_strip(app), (strip) => strip.tabs.length === 4 && strip.tabs[0].name === 'Plan the week', 'four tabs');
    for (const place of [1, 2, 3, 0]) {
      await select_tab(app, place);
      await until(() => read_front_address(app), (address) => address === `${server.address}${paths[place]}`, `tab ${place + 1} is loaded`);
    }
    // "Sign out" ends the session and sends the page to the first page of the server.
    server.read_state().sign_in = 'link';
    await app.in_front_tab(`location.href = '/'; true`);
    await see_step(app, 'sign_in_link');
    const signed_out = await read_strip(app);
    check(signed_out.tabs.length === 0 && signed_out.is_covered, 'signed out, the strip shows no tab and no name', signed_out.tabs);
    await choose_every_row(app);
    await type_in_setup(app, server.make_sign_in_link().link);
    await press_in_setup(app, 'Sign in');
    await see_no_setup(app);
    const back = await until(() => read_strip(app), (strip) => strip.tabs.length === 4 && strip.tabs.every((tab) => tab.name !== ''), 'signed in again: the four tabs, each with its name');
    check(JSON.stringify(read_names(back)) === JSON.stringify(['Plan the week', 'Inbox', 'Scheduled tasks', 'A report with a long name that does not fit in a tab']), 'the same tabs as before', read_names(back));
    await until(() => read_front_address(app), (address) => address === `${server.address}${paths[0]}`, 'the tab in front is back on its page');
    for (const place of [1, 2, 3, 0, 2]) {
      await select_tab(app, place);
      await until(() => read_front_address(app), (address) => address === `${server.address}${paths[place]}`, `after the sign-in, tab ${place + 1} shows its own page`);
      see_that_the_app_never_threw(app);
    }
    const title = await app.in_front_tab('document.title');
    check(title === 'Scheduled tasks · Alfera', 'the page of the tab is the page of Alfera, not a refusal', title);
    return app;
  },

  // A server with a sign-in page of its own: no screen of the app covers it, no tab has a name,
  // and a question typed in the bar is kept.
  signed_out_on_a_server_with_its_own_sign_in_page: async ({ start, server }) => {
    server.read_state().sign_in = 'own_page';
    const app = await start({ settings: { address: server.address, person: 'user_stand_in_1', front_tab: 0, tabs: [`${server.address}/inbox`] } });
    await until(() => read_front_address(app), (address) => address === `${server.address}/sign-in?returnTo=%2Finbox`, 'the sign-in page of the server shows');
    await wait(5000);
    const strip = await read_strip(app);
    check(strip.tabs.length === 0 && !strip.is_covered, 'signed out: no tab and no name in the strip, and no screen of the app over the page', strip);
    check((await read_setup(app)).step === null, 'the app does not ask for a link');
    await choose_every_row(app);
    await press_everything_in_the_strip(app);
    await wait(500);
    see_that_the_app_never_threw(app);
    await until(() => read_front_address(app), (address) => address?.startsWith(server.address), 'a page of the server is in front');
    await ask_through_the_bar(app, 'A question typed while signed out');
    const bar = await until(() => read_bar(app), (now) => now.note !== '', 'the bar says why the question was not sent');
    check(bar.note === 'Sign in to Alfera first, then press Return again.' && bar.question === 'A question typed while signed out' && !bar.waits, 'the question stays in the bar, with one line that says what to do', bar);
    check(server.read_state().questions.length === 0, 'nothing was sent to the server');
    const kept = app.read_settings().tabs;
    check(kept.every((address) => !address.includes('/sign-in')), 'the tab is written down with the page it is for, not with the sign-in page', kept);
    return app;
  },

  // The bar starts a chat with the question, and keeps the question when the chat did not get it.
  a_question_through_the_bar: async ({ start, server }) => {
    const app = await start({ settings: { address: server.address } });
    await see_tabs(app, 1);
    await until(() => web_pages_of(app), (pages) => pages.length >= 1, 'the app is signed in');
    await wait(1500);
    await ask_through_the_bar(app, 'What is on today?');
    await until(async () => server.read_state().questions, (questions) => questions.length === 1, 'the server got the question');
    const asked = server.read_state().questions[0];
    check(asked.message === 'What is on today?' && typeof asked.client_message_id === 'string', 'the question arrived as typed', asked);
    await until(() => read_front_address(app), (address) => address === `${server.address}/chats/${asked.session_id}`, 'the new chat opens in a tab');
    check((await read_bar(app)).question === '', 'the bar is empty after the question was sent');

    server.read_state().takes_questions = false;
    const chats_before = server.read_state().chats.length;
    await ask_through_the_bar(app, 'A question the server does not take');
    const bar = await until(() => read_bar(app), (now) => now.note !== '', 'the bar says the question was not taken');
    check(bar.note === 'Alfera did not take the question. Press Return to send it again.' && bar.question === 'A question the server does not take', 'the question stays in the bar', bar);
    const tabs_before = (await read_strip(app)).tabs.length;
    server.read_state().takes_questions = true;
    await ask_through_the_bar(app, 'A question the server does not take');
    await until(async () => server.read_state().questions, (questions) => questions.length === 2, 'the second try sends the question');
    check(server.read_state().chats.length === chats_before + 1, 'the second try used the chat of the first try: no empty chat is left', server.read_state().chats.length - chats_before);
    await see_tabs(app, tabs_before + 1, 'the chat opens once it has its question');
    return app;
  },

  // A tab long out of sight sleeps: its page is closed. Shown again, it is the same chat at the
  // same place. And a chat that starts or ends an answer is read at once, not at the next tick.
  a_tab_that_slept: async ({ start, server }) => {
    const chat = `${server.address}/chats/ses_aaa1`;
    const app = await start({
      settings: { address: server.address, person: 'user_stand_in_1', front_tab: 0, tabs: [chat, `${server.address}/inbox`] },
      environment: { ALFERA_TAB_SLEEP_MINUTES: '0.05' },
    });
    await until(() => read_strip(app), (strip) => strip.tabs.length === 2 && strip.tabs[0].name === 'Plan the week', 'two tabs');
    await until(() => read_front_address(app), (address) => address === chat, 'the chat is loaded');

    const read_since = (moment) => server.read_state().times_the_chats_were_read.filter((time) => time >= moment).length;
    for (const is_under_way of [true, false, true, false]) {
      await wait(600);
      const moment = Date.now();
      await app.in_front_tab(`show_an_answer_under_way(${is_under_way}); true`);
      await until(async () => read_since(moment), (reads) => reads >= 1, `the chats are read at once when an answer ${is_under_way ? 'starts' : 'ends'}`, 1.5);
    }

    await app.in_front_tab(`document.querySelector('main').scrollTop = 700; true`);
    const place_before = await app.in_front_tab(`document.querySelector('main').scrollTop`);
    await select_tab(app, 1);
    await until(() => web_pages_of(app), (pages) => !pages.includes(chat), 'the chat tab sleeps: its page is closed', 20);
    check((await read_strip(app)).tabs[0].name === 'Plan the week', 'the sleeping tab keeps its name');
    await select_tab(app, 0);
    await until(() => read_front_address(app), (address) => address === chat, 'the tab wakes on the same chat');
    const place_after = await until(() => app.in_front_tab(`document.querySelector('main').scrollTop`), (place) => Math.abs(place - place_before) <= 2, 'the chat is at the place it was left at');
    check(place_before === 700, 'the place that was kept is the place the person left', { place_before, place_after });
    return app;
  },

  // A server that is away, that answers with an error, and that does not answer.
  server_away: async ({ start, server }) => {
    const inbox = `${server.address}/inbox`;
    const app = await start({ settings: { address: server.address, person: 'user_stand_in_1', front_tab: 1, tabs: [`${server.address}/chats/ses_aaa1`, inbox] } });
    await until(() => read_front_address(app), (address) => address === inbox, 'the tab in front is loaded');
    await until(() => read_strip(app), (strip) => strip.tabs.length === 2 && strip.tabs[0].name === 'Plan the week', 'two tabs with their names');

    const see_the_cannot_reach_page = async (kind) => {
      const address = await until(() => read_front_address(app), (now) => now?.startsWith('file:') && now.includes('unreachable.html'), 'the page that says Alfera cannot be reached shows');
      const asked = new URL(address).searchParams;
      check(asked.get('kind') === kind && asked.get('host') === server.host && [...asked.keys()].sort().join() === 'host,kind,seconds', 'the page is told the host and the kind, and no address', address);
      const page = await app.in_front_tab(`({ title: document.querySelector('h1').textContent, detail: document.getElementById('detail').textContent, next: document.getElementById('next').textContent, button: document.getElementById('retry').textContent, page_color: getComputedStyle(document.body).backgroundColor })`);
      check(page.title === 'Alfera cannot be reached.' && page.button === 'Try again' && /^Alfera tries again in \d+ seconds?\.$|^Trying again now\.$/.test(page.next), 'the page says what happened, tries again by itself and says so', page);
      const strip = await read_strip(app);
      check(strip.tabs[1].name === 'Inbox' && strip.tabs.length === 2, 'the tab keeps its own name', read_names(strip));
      check(JSON.stringify(app.read_settings().tabs) === JSON.stringify([`${server.address}/chats/ses_aaa1`, inbox]), 'the tab is written down with its real address', app.read_settings().tabs);
      return page;
    };

    await server.go_away();
    await choose(app, 'Reload');
    const away = await see_the_cannot_reach_page('no_answer');
    check(away.detail === `No answer from ${server.host}. Check your connection.`, 'the page names the server', away.detail);
    await ask_through_the_bar(app, 'A question while the server is away');
    const bar = await until(() => read_bar(app), (now) => now.note !== '', 'the bar says Alfera did not answer');
    check(bar.note === 'Alfera did not answer. Check your connection, then press Return again.' && bar.question !== '', 'the question stays in the bar', bar);
    await server.come_back();
    await until(() => read_front_address(app), (address) => address === inbox, 'with the server back, the page loads again by itself', 30);

    server.read_state().answers_pages_with = 502;
    await choose(app, 'Reload');
    const error = await see_the_cannot_reach_page('server_error');
    check(error.detail === `${server.host} answered with an error. The server may be starting.`, 'the page says the server answered with an error', error.detail);
    const strip = await read_strip(app);
    check(strip.band === 0, 'the strip has no band over a page with no sidebar', strip.band);
    server.read_state().answers_pages_with = null;
    await until(() => read_front_address(app), (address) => address === inbox, 'when the server answers well again, the page loads by itself', 30);

    // A server that takes the request and says nothing: the tab shows that it loads, and after a
    // while the app says so itself.
    server.read_state().answers_pages_with = 'never';
    await choose(app, 'Reload');
    await until(() => read_strip(app), (now) => now.tabs[1]?.mark === 'loading', 'the tab shows that its page loads');
    await until(() => read_front_address(app), (address) => address?.includes('unreachable.html'), 'a page with no answer gives way to the page of the app', 30);
    await see_the_cannot_reach_page('no_answer');
    // Every row of every menu, with the page of the app in front and the server still silent.
    await choose_every_row(app);
    await press_everything_in_the_strip(app);
    await wait(800);
    see_that_the_app_never_threw(app);
    const kept = app.read_settings().tabs;
    check(kept.length >= 1 && kept.every((address) => address.startsWith(server.address)), 'every tab is written down with an address of the server, never with a page of the app', kept);
    server.read_state().answers_pages_with = null;
    return app;
  },
};

async function main() {
  const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(runs);
  const server = await start_stand_in_alfera();
  const failed = [];
  for (const name of wanted) {
    server.start_over();
    const apps = [];
    const start = async (options) => {
      const app = start_hidden_app({ ...options, environment: { ALFERA_INSTALLER_ADDRESS: `${server.address}/installer`, ...options.environment } });
      apps.push(app);
      await until(() => app.in_main('Boolean(the_window())'), Boolean, 'the app starts');
      await see_that_nothing_shows(app, 'at the start of the run');
      return app;
    };
    try {
      const app = await runs[name]({ start, server });
      see_that_the_app_never_threw(app);
      await see_that_nothing_shows(app, 'at the end of the run');
      console.log(`ok    ${name}`);
    } catch (error) {
      if (error instanceof SomethingShowed) {
        console.log(`STOPPED  ${name}\n      ${error.message}`);
        process.exit(2);
      }
      failed.push(name);
      const errors = apps.at(-1)?.read_errors().trim().split('\n').slice(-12).join('\n      ') ?? '';
      console.log(`FAIL  ${name}\n      ${error.message}${errors ? `\n      the app wrote:\n      ${errors}` : ''}`);
    } finally {
      for (const app of apps) {
        await app.stop();
        app.remove_files();
      }
      await server.come_back().catch(() => {});
    }
  }
  await server.go_away();
  console.log(failed.length === 0 ? `every run passed: ${wanted.length}` : `runs that failed: ${failed.join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
