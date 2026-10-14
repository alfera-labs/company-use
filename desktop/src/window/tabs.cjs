const { BrowserWindow, WebContentsView, ipcMain, nativeTheme } = require('electron');
const path = require('node:path');
const { show, take_the_keyboard } = require('../invisible_run.cjs');
const {
  read_settings,
  write_settings,
  read_address,
  has_chosen_an_address,
} = require('../settings.cjs');
const { keep_outside_links_out, is_on_alfera } = require('./alfera_pages.cjs');
const { show_context_menu_on } = require('./page_context_menu.cjs');
const {
  is_server_error,
  parse_page,
  read_address_to_come_back_to,
  read_chat_id,
  read_tab_name,
  read_what_page_asks,
  seconds_before_try,
  without_sign_in_link,
} = require('./tab_pages.cjs');
const { may_tab_sleep, page_is_in_use_script, sleep_check_every_ms } = require('./tab_sleep.cjs');

const tab_strip_height = 44;
const page_settings = { contextIsolation: true, nodeIntegration: false, sandbox: true };
const spare_page_delay_ms = 1500;
const seconds_a_page_may_take_to_answer = 20;
const error_of_a_load_that_was_replaced = -3;
// The colour of an Alfera page before the page says its own, so nothing flashes white.
const page_color_before_the_page_loads = () => (nativeTheme.shouldUseDarkColors ? '#202026' : '#fbfaf9');

// One window. The strip at the top is the app's own page; under it, each tab is one Alfera page.
// Only the tab in front is shown. A tab shows "working" and then "needs you" from what Alfera
// says about its chat, not from its own page, so a tab that is long out of sight can sleep.
// The strip names tabs only for a person who is signed in: until Alfera says who that is, and
// after they sign out, it shows no tab at all.
// `on_front_page_asks` hears what the page in front wants from the person (tab_pages.cjs).
function create_tabbed_window({ on_front_page_asks = () => {} } = {}) {
  const window = new BrowserWindow({
    ...(read_settings().bounds ?? { width: 1280, height: 860 }),
    minWidth: 520,
    minHeight: 560,
    title: 'Alfera',
    backgroundColor: page_color_before_the_page_loads(),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: { ...page_settings, preload: path.join(__dirname, 'shell_preload.cjs') },
  });
  window.loadFile(path.join(__dirname, 'shell.html'));

  let tabs = [];
  let front_tab_id = null;
  let next_tab_id = 1;
  let sessions_by_id = {};
  let spare = null;
  let cover = null;
  // Who is signed in: undefined until Alfera has said, null when nobody is.
  let person;
  const listeners = [];

  const front_tab = () => tabs.find((tab) => tab.id === front_tab_id) ?? null;
  const tab_of = (contents) =>
    [...tabs, spare].find((tab) => tab?.view?.webContents === contents) ?? null;
  const tell_the_strip = (channel, value) =>
    !window.isDestroyed() && window.webContents.send(channel, value);

  // What is known about the page of a tab, in the plain form tab_pages.cjs reads.
  const page_of = (tab) => ({
    address: tab.view?.webContents.getURL() ?? tab.asleep.url,
    http_status: tab.http_status,
    address_that_failed: tab.address_that_failed,
    page_before_sign_in: tab.page_before_sign_in,
  });
  const address_to_come_back_to = (tab) => read_address_to_come_back_to(page_of(tab));
  const chat_in = (tab) => read_chat_id(address_to_come_back_to(tab));
  const pathname_of = (tab) => parse_page(address_to_come_back_to(tab))?.pathname ?? null;
  const what_front_page_asks = () => (front_tab() ? read_what_page_asks(page_of(front_tab())) : null);

  function describe(tab) {
    const session = sessions_by_id[chat_in(tab)];
    return {
      id: tab.id,
      title: read_tab_name({
        page: page_of(tab),
        page_title: tab.view?.webContents.getTitle() ?? '',
        chat_title: session?.title,
      }),
      state: session?.state ?? null,
      is_loading: Boolean(tab.view) && tab.is_loading,
      in_front: tab.id === front_tab_id,
    };
  }

  const is_signed_in = () => typeof person === 'string';
  // The tabs are the person's to use once they have said where their Alfera is, and while no
  // screen of the app itself covers them.
  const is_in_use = () => has_chosen_an_address() && !cover;

  function show_tabs_in_the_strip() {
    tell_the_strip('tabs:changed', is_signed_in() && !cover ? tabs.map(describe) : []);
  }

  // No title is written down: a title is shown only to the person Alfera says is signed in.
  // A tab with no address yet is not written down either.
  function tell_everyone() {
    show_tabs_in_the_strip();
    if (has_chosen_an_address()) {
      write_settings({
        tabs: tabs.map(address_to_come_back_to).filter(Boolean),
        tab_titles: undefined,
        front_tab: Math.max(0, tabs.indexOf(front_tab())),
      });
    }
    for (const listener of listeners) listener();
  }

  function fit_front_tab() {
    const [width, height] = window.getContentSize();
    const under_the_strip = { x: 0, y: tab_strip_height, width, height: height - tab_strip_height };
    for (const tab of tabs) tab.view?.setVisible(tab.id === front_tab_id);
    front_tab()?.view?.setBounds(under_the_strip);
    cover?.setBounds(under_the_strip);
    spare?.view.setBounds(under_the_strip);
  }

  // One page of the app itself over the tabs: the setup. While it is there the strip is bare.
  function cover_the_tabs(view) {
    cover = view;
    window.contentView.addChildView(view);
    fit_front_tab();
    tell_the_strip('strip:covered', true);
    tell_everyone();
  }

  function uncover_the_tabs() {
    if (!cover) return;
    window.contentView.removeChildView(cover);
    cover = null;
    tell_the_strip('strip:covered', false);
    if (front_tab()?.look) tell_the_strip('look:changed', front_tab().look);
    tell_everyone();
  }

  // Alfera said who is signed in, or that nobody is. Another person than last time gets none of
  // the tabs that were open. The same person gets them back: the tab in front goes back to the
  // page it was on, and each other tab loads again when it is shown, because a page that was
  // sent to sign-in does not come back by itself.
  function show_person(now) {
    if (now === person) return;
    const before = person;
    person = now;
    if (!is_signed_in()) return tell_everyone();
    const is_another_person = (read_settings().person ?? now) !== now;
    write_settings({ person: now });
    if (is_another_person) return open_only_the_address();
    if (before === null) {
      for (const tab of tabs) if (tab.view && tab.id !== front_tab_id) put_to_sleep(tab);
      go_back_after_sign_in(front_tab());
    }
    setTimeout(load_a_spare_page, spare_page_delay_ms);
    tell_everyone();
  }

  function go_back_after_sign_in(tab) {
    const wanted = tab?.goes_back_after_sign_in;
    if (!tab?.view || !wanted) return;
    tab.goes_back_after_sign_in = null;
    const is_only_the_server = parse_page(wanted).pathname === '/';
    const is_there_already = wanted === without_sign_in_link(tab.view.webContents.getURL());
    if (!is_only_the_server && !is_there_already) tab.view.webContents.loadURL(wanted);
  }

  // The link signs the person in, in the tab in front. That tab then goes back to its page.
  function open_sign_in_link(link) {
    const tab = front_tab();
    if (!tab) return open_tab(link);
    if (tab.asleep) wake(tab);
    tab.goes_back_after_sign_in = address_to_come_back_to(tab);
    tab.address_that_failed = null;
    tab.view.webContents.loadURL(link);
  }

  function select_tab(tab_id) {
    const tab = tabs.find((candidate) => candidate.id === tab_id);
    if (!tab) return;
    if (front_tab()) front_tab().hidden_since = Date.now();
    front_tab_id = tab_id;
    if (tab.asleep) wake(tab);
    // The person may have signed in from another tab since this page was refused: it asks again.
    else if (read_what_page_asks(page_of(tab)) === 'sign_in_link' && !tab.is_loading) {
      tab.view.webContents.reload();
    }
    fit_front_tab();
    take_the_keyboard(tab.view.webContents);
    if (tab.look) tell_the_strip('look:changed', tab.look);
    tell_everyone();
    tell_what_front_page_asks();
  }

  // The page in front may want a sign-in link. The app then shows a screen of its own for that,
  // and nobody is signed in: the names of the tabs go at once.
  function tell_what_front_page_asks() {
    const asks = what_front_page_asks();
    if (asks) show_person(null);
    on_front_page_asks(asks);
  }

  // ---- a page that does not load, or that the server answers with an error -------------------
  // The tab keeps the address it is for, and shows the app's own page with a way to try again.
  // That page never gets the address: a sign-in link must not be shown or written down.
  function show_cannot_reach(tab, address, kind) {
    clearTimeout(tab.answer_timer);
    tab.address_that_failed = address;
    tab.number_of_tries += 1;
    tab.view.webContents.loadFile(path.join(__dirname, '..', 'unreachable.html'), {
      query: {
        host: parse_page(address)?.host ?? '',
        kind,
        seconds: String(seconds_before_try(tab.number_of_tries)),
      },
    });
  }

  function try_again(tab) {
    if (!tab?.view || !tab.address_that_failed) return;
    const address = tab.address_that_failed;
    tab.address_that_failed = null;
    tab.view.webContents.loadURL(address);
  }

  // A page that gives no answer at all would stay empty for a minute. After a while the app
  // says so itself.
  function wait_for_an_answer(tab) {
    clearTimeout(tab.answer_timer);
    tab.answer_timer = setTimeout(() => {
      const contents = tab.view?.webContents;
      if (!contents || !tab.is_loading || tab.address_that_failed) return;
      const address = tab.address_being_loaded;
      contents.stop();
      if (address) show_cannot_reach(tab, address, 'no_answer');
    }, seconds_a_page_may_take_to_answer * 1000);
  }

  function follow_the_loading_of(contents) {
    contents.on('did-start-navigation', (navigation) => {
      const tab = tab_of(contents);
      const is_a_new_page = navigation.isMainFrame && !navigation.isSameDocument;
      if (!tab || !is_a_new_page || !parse_page(navigation.url)) return;
      tab.address_being_loaded = navigation.url;
      tab.is_loading = true;
      wait_for_an_answer(tab);
      show_tabs_in_the_strip();
    });
    contents.on('did-stop-loading', () => {
      const tab = tab_of(contents);
      if (!tab) return;
      tab.is_loading = false;
      clearTimeout(tab.answer_timer);
      show_tabs_in_the_strip();
    });
    contents.on('did-fail-load', (_event, code, _text, url, is_main_frame) => {
      const tab = tab_of(contents);
      if (!tab || !is_main_frame || code === error_of_a_load_that_was_replaced) return;
      if (parse_page(url)) show_cannot_reach(tab, url, 'no_answer');
    });
  }

  function follow_the_pages_of(contents) {
    for (const event of ['page-title-updated', 'did-navigate-in-page']) contents.on(event, tell_everyone);
    contents.on('did-navigate', (_event, url, http_status) => {
      const tab = tab_of(contents);
      if (!tab || !parse_page(url)) return tell_everyone();
      if (is_server_error(http_status)) return show_cannot_reach(tab, url, 'server_error');
      // The server answered. The rest of the page can take its time.
      clearTimeout(tab.answer_timer);
      tab.http_status = http_status;
      tab.address_that_failed = null;
      tab.number_of_tries = 0;
      if (!read_what_page_asks(page_of(tab))) tab.page_before_sign_in = without_sign_in_link(url);
      tell_everyone();
      if (tab.id === front_tab_id) tell_what_front_page_asks();
    });
    contents.on('did-navigate-in-page', (_event, url) => {
      const tab = tab_of(contents);
      if (tab && parse_page(url) && !read_what_page_asks(page_of(tab))) tab.page_before_sign_in = url;
    });
  }

  function create_view() {
    const view = new WebContentsView({
      webPreferences: {
        ...page_settings,
        preload: path.join(__dirname, 'alfera_page_preload.cjs'),
      },
    });
    view.setBackgroundColor(front_tab()?.look?.page_color ?? page_color_before_the_page_loads());
    keep_outside_links_out(view.webContents, open_tab_for_the_person);
    show_context_menu_on(view.webContents, open_tab_for_the_person);
    follow_the_loading_of(view.webContents);
    follow_the_pages_of(view.webContents);
    view.setVisible(false);
    window.contentView.addChildView(view);
    return view;
  }

  const create_tab = (page) => ({
    id: next_tab_id++,
    view: null,
    asleep: null,
    look: null,
    http_status: null,
    page_before_sign_in: null,
    address_that_failed: null,
    address_being_loaded: null,
    goes_back_after_sign_in: null,
    number_of_tries: 0,
    is_loading: false,
    answer_timer: null,
    place_in_the_page: null,
    hidden_since: Date.now(),
    ...page,
  });
  const create_page = () => create_tab({ view: create_view() });

  function close_page_of(tab) {
    clearTimeout(tab.answer_timer);
    if (!tab.view) return;
    window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    tab.view = null;
    tab.is_loading = false;
  }

  // A sleeping tab has no page. It keeps the address to load when it is shown again, and what
  // it knew about the old page goes with the page: a new page starts with nothing known.
  function put_to_sleep(tab, place_in_the_page = null) {
    const url = address_to_come_back_to(tab);
    if (!url) return;
    tab.asleep = { url };
    tab.place_in_the_page = place_in_the_page;
    close_page_of(tab);
    tab.http_status = null;
    tab.address_that_failed = null;
    tab.number_of_tries = 0;
    tab.page_before_sign_in = url;
  }

  // The person finds the page where they left it: it scrolls back to the place it was at.
  function wake(tab) {
    const { url } = tab.asleep;
    tab.view = create_view();
    tab.asleep = null;
    tab.view.webContents.loadURL(url);
    const place = tab.place_in_the_page;
    tab.place_in_the_page = null;
    if (!place) return;
    tab.view.webContents.once('did-finish-load', () => {
      tab.view?.webContents.executeJavaScript(`(${go_to_place_in_page})(${JSON.stringify(place)})`).catch(() => {});
    });
  }

  async function put_to_sleep_if_long_hidden(tab) {
    const may_sleep = () =>
      Boolean(tab.view) &&
      tabs.includes(tab) &&
      !tab.address_that_failed &&
      is_on_alfera(page_of(tab).address) &&
      may_tab_sleep({
        is_in_front: tab.id === front_tab_id,
        is_loading: tab.is_loading,
        hidden_for_ms: Date.now() - tab.hidden_since,
        session_state: sessions_by_id[chat_in(tab)]?.state,
      });
    if (!may_sleep()) return;
    const contents = tab.view.webContents;
    const is_in_use_now = await contents.executeJavaScript(page_is_in_use_script);
    if (is_in_use_now || !may_sleep()) return;
    const place = await contents.executeJavaScript(`(${read_place_in_page})()`).catch(() => null);
    // The person can come back to the tab while its page answers, so the rule is read again.
    if (may_sleep()) put_to_sleep(tab, place);
  }

  // Loading Alfera from zero takes seconds and shows an empty skeleton. So one page is always
  // loaded ahead of time. A new tab takes that page and only switches the chat inside it, which
  // is as fast as a click in the browser.
  // One spare page costs the memory of one tab. Drop it on machines where that hurts.
  // A page that loads while it is hidden is told its window has no width, and Alfera then lays
  // itself out as on a phone: sidebar folded. Shown later, it would unfold in front of the person.
  // So the spare page is not hidden. It has the size of a tab and lies under every other page,
  // where nothing of it can be seen: the page in front covers it whole.
  function load_a_spare_page() {
    if (spare || window.isDestroyed() || tabs.length === 0 || !is_signed_in()) return;
    spare = create_page();
    window.contentView.addChildView(spare.view, 0);
    spare.view.setVisible(true);
    fit_front_tab();
    spare.view.webContents.loadURL(`${read_address()}/home`);
  }

  function take_the_spare_page_if_it_is_ready() {
    const is_ready =
      spare && !spare.is_loading && !spare.address_that_failed && pathname_of(spare) === '/home' &&
      !read_what_page_asks(page_of(spare));
    if (!is_ready) return null;
    const ready = spare;
    spare = null;
    return ready;
  }

  function open_tab(url = `${read_address()}/home`) {
    const target = parse_page(url);
    if (!target) return null;
    const loaded_ahead = is_on_alfera(url) ? take_the_spare_page_if_it_is_ready() : null;
    const tab = loaded_ahead ?? create_page();
    tabs.push(tab);
    if (!loaded_ahead) tab.view.webContents.loadURL(url);
    else if (target.pathname !== '/home') go_to_in(tab, target);
    select_tab(tab.id);
    setTimeout(load_a_spare_page, spare_page_delay_ms);
    return tab;
  }

  // What a person does to the tabs, from a menu, a shortcut, the strip or a link. None of it
  // does anything before they have said where their Alfera is, or while the setup shows.
  const only_in_use = (action) => (...inputs) => (is_in_use() ? action(...inputs) : undefined);
  const open_tab_for_the_person = only_in_use((url) => {
    open_tab(url);
    show(window);
  });

  // One empty "New chat" tab is enough. A second press goes to the one that is already there.
  // The window comes up with it: a new tab in a closed window is a tab nobody sees.
  function open_new_chat_tab() {
    const empty_new_chat = tabs.find((tab) => pathname_of(tab) === '/home');
    if (empty_new_chat) select_tab(empty_new_chat.id);
    else open_tab();
    show(window);
  }

  function close_tab(tab_id = front_tab_id) {
    const index = tabs.findIndex((tab) => tab.id === tab_id);
    if (index === -1) return;
    const [closed] = tabs.splice(index, 1);
    close_page_of(closed);
    if (tabs.length === 0) return void open_tab();
    if (closed.id === front_tab_id) return select_tab(tabs[Math.min(index, tabs.length - 1)].id);
    tell_everyone();
  }

  // Goes there the way a click in the page would, so the page does not load again from zero.
  // When the page has no link to that place, it loads the address in full.
  function go_to_in(tab, target) {
    const load_in_full = () => tab.view?.webContents.loadURL(target.href);
    const link = `a[href=${JSON.stringify(target.pathname + target.search)}]`;
    const click_the_link = `(() => { const link = document.querySelector(${JSON.stringify(link)}); link?.click(); return Boolean(link); })()`;
    tab.view.webContents
      .executeJavaScript(click_the_link)
      .then((clicked) => clicked || load_in_full())
      .catch(load_in_full);
  }

  function open_chat(session_id) {
    const already_open = tabs.find((tab) => chat_in(tab) === session_id);
    if (already_open) select_tab(already_open.id);
    else open_tab(`${read_address()}/chats/${session_id}`);
    show(window);
  }

  function select_tab_at(index) {
    const tab = tabs.at(index === 8 ? -1 : index);
    if (tab) select_tab(tab.id);
  }

  function select_neighbour_tab(step) {
    if (tabs.length === 0) return;
    const index = (Math.max(0, tabs.indexOf(front_tab())) + step + tabs.length) % tabs.length;
    select_tab(tabs[index].id);
  }

  // Another server, or another person: nothing of what was open stays, not even a name.
  function open_only_the_address(page = read_address()) {
    for (const tab of [...tabs, spare]) if (tab) close_page_of(tab);
    tabs = [];
    spare = null;
    front_tab_id = null;
    sessions_by_id = {};
    open_tab(page);
  }

  // Only the tab that was in front loads now. The others start asleep and load when they are
  // first shown, so opening the app with many tabs costs the memory of one. Before the person
  // has said where their Alfera is, there is nothing to open. An address from an older version
  // of the app can hold a sign-in link: it is taken out here, before anything is written again.
  function open_the_tabs_from_last_time() {
    if (!has_chosen_an_address()) return;
    const { tabs: urls = [], front_tab: front = 0 } = read_settings();
    const saved = urls.map(without_sign_in_link).filter((url) => url && is_on_alfera(url));
    if (saved.length === 0) return void open_tab(read_address());
    tabs = saved.map((url) => create_tab({ asleep: { url }, page_before_sign_in: url }));
    select_tab((tabs[front] ?? tabs[0]).id);
    setTimeout(load_a_spare_page, spare_page_delay_ms);
  }

  ipcMain.on('tabs:select', only_in_use((_event, tab_id) => select_tab(tab_id)));
  ipcMain.on('tabs:close', only_in_use((_event, tab_id) => close_tab(tab_id)));
  ipcMain.on('tabs:new', only_in_use(open_new_chat_tab));
  ipcMain.on('tabs:open_in_new_tab', (event, url) => {
    if (tab_of(event.sender) && tab_of(event.sender) !== spare && is_on_alfera(url)) open_tab_for_the_person(url);
  });
  ipcMain.on('tabs:try_again', (event) => try_again(tab_of(event.sender)));
  ipcMain.on('page:look', (event, look) => {
    const tab = tab_of(event.sender);
    if (!tab?.view) return;
    const answer_started_or_ended = Boolean(tab.look) && tab.look.is_answering !== look.is_answering;
    tab.look = look;
    if (look.page_color) tab.view.setBackgroundColor(look.page_color);
    // While a screen of the app covers the tabs, the strip has the colours of that screen.
    if (tab.id === front_tab_id && !cover) tell_the_strip('look:changed', look);
    // A chat that starts or ends an answer is told at once: the mark on its tab does not wait.
    if (answer_started_or_ended) for (const listener of listeners) listener();
  });
  window.on('resize', fit_front_tab);
  window.on('enter-full-screen', () => tell_the_strip('window:full_screen', true));
  window.on('leave-full-screen', () => tell_the_strip('window:full_screen', false));
  window.on('close', () => write_settings({ bounds: window.getBounds() }));
  const sleep_timer = setInterval(() => {
    for (const tab of tabs) put_to_sleep_if_long_hidden(tab).catch(() => {});
  }, sleep_check_every_ms);
  window.on('closed', () => clearInterval(sleep_timer));
  // The strip hears nothing before its page has loaded, so what it must show is said again then.
  window.webContents.once('did-finish-load', () => {
    tell_the_strip('strip:covered', Boolean(cover));
    open_the_tabs_from_last_time();
  });
  window.once('ready-to-show', () => show(window));

  return {
    window,
    open_tab: open_tab_for_the_person,
    open_new_chat_tab: only_in_use(open_new_chat_tab),
    close_tab: only_in_use(close_tab),
    open_chat: only_in_use(open_chat),
    select_tab_at: only_in_use(select_tab_at),
    select_neighbour_tab: only_in_use(select_neighbour_tab),
    // The three below are for the setup: it works while it covers the tabs.
    open_only_the_address,
    open_sign_in_link,
    open_page_beside_the_tabs: (url) => void open_tab(url),
    cover_the_tabs,
    uncover_the_tabs,
    show_person,
    forget_the_person: () => {
      person = undefined;
      write_settings({ person: undefined });
      show_tabs_in_the_strip();
    },
    is_in_use,
    is_signed_in,
    read_what_front_page_asks: what_front_page_asks,
    front_page: () => front_tab()?.view?.webContents ?? null,
    front_page_in_use: () => (is_in_use() ? (front_tab()?.view?.webContents ?? null) : null),
    strip_page: () => window.webContents,
    count_sleeping_tabs: () => tabs.filter((tab) => tab.asleep).length,
    count_tabs: () => tabs.length,
    on_change: (listener) => listeners.push(listener),
    show_session_states: (sessions) => {
      sessions_by_id = sessions;
      show_tabs_in_the_strip();
    },
  };
}

// Run inside the page. The part of a page that scrolls is the tallest block with more in it
// than it shows. Its place is kept as the distance from the end, because a chat grows at its end.
function read_place_in_page() {
  const blocks = [...document.querySelectorAll('*')].filter((block) => {
    const overflow = getComputedStyle(block).overflowY;
    return block.scrollHeight > block.clientHeight + 40 && (overflow === 'auto' || overflow === 'scroll');
  });
  const tallest = blocks.sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (!tallest) return null;
  return { from_the_end: tallest.scrollHeight - tallest.clientHeight - tallest.scrollTop, height: tallest.scrollHeight };
}

// Run inside the page after it loaded again. The page fills in over a moment, so the place is
// set once the page is as long as it was, or after a few seconds with what is there.
function go_to_place_in_page(place) {
  const started = Date.now();
  const timer = setInterval(() => {
    const blocks = [...document.querySelectorAll('*')].filter((block) => {
      const overflow = getComputedStyle(block).overflowY;
      return block.scrollHeight > block.clientHeight + 40 && (overflow === 'auto' || overflow === 'scroll');
    });
    const tallest = blocks.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    const is_as_long_as_before = tallest && tallest.scrollHeight >= place.height - 40;
    if (!is_as_long_as_before && Date.now() - started < 5000) return;
    clearInterval(timer);
    if (tallest) tallest.scrollTop = tallest.scrollHeight - tallest.clientHeight - place.from_the_end;
  }, 200);
}

module.exports = { create_tabbed_window, tab_strip_height };
