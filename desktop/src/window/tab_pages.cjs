// What a tab is for, told from what is known about its page. Everything here is plain: no
// window, no page. A tab can have no address at all (a page that has not loaded yet), and every
// function here says what holds then.
const status_of_a_page_that_asks_for_sign_in = 401;
const status_of_a_link_that_is_not_valid = 404;
const first_status_of_a_server_error = 500;
const seconds_before_each_new_try = [5, 10, 20, 40, 60];
const names_by_path = { '/': 'New chat', '/home': 'New chat' };
// What a page is called before it has a name of its own. A chat is never shown under one.
const titles_that_name_no_chat = ['', 'Alfera', 'New chat', 'Home', 'Chats', 'Sign in'];

// The web address of a page, or null: for no address, an empty page, and a page of the app itself.
function parse_page(address) {
  const url = URL.parse(address ?? '');
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url : null;
}

const is_sign_in_link = (url) => url.pathname.startsWith('/join/');
const holds_a_secret = (url) => is_sign_in_link(url) || new URLSearchParams(url.hash.slice(1)).has('token');
const is_sign_in_page = (url) => url.pathname === '/sign-in';

function is_sign_in_link_address(address) {
  const url = parse_page(address);
  return Boolean(url) && is_sign_in_link(url);
}

// A sign-in link is a secret that works once. Wherever an address is kept or shown, the link
// gives way to the server it is for.
function without_sign_in_link(address) {
  const url = parse_page(address);
  if (!url) return null;
  return holds_a_secret(url) ? `${url.origin}/` : url.href;
}

// `page` is what is known about the page of a tab:
//   address               what the page says its address is; empty for a page not loaded yet
//   http_status           the status the server gave for it
//   address_that_failed   set while the "cannot be reached" page stands in for it
//   page_before_sign_in   the last Alfera page it showed that asked for no sign-in
const address_of_the_page = (page) => page.address_that_failed ?? page.address;

// What the page wants from the person before it shows anything of Alfera, or null.
//   sign_in_link       a server that signs people in with a link refused the page
//   new_sign_in_link   a sign-in link was opened that is used up or not valid
//   sign_in_page       the server shows a sign-in page of its own
function read_what_page_asks(page) {
  if (page.address_that_failed) return null;
  const url = parse_page(page.address);
  if (!url) return null;
  if (is_sign_in_link(url)) {
    return page.http_status === status_of_a_link_that_is_not_valid ? 'new_sign_in_link' : null;
  }
  if (page.http_status === status_of_a_page_that_asks_for_sign_in) return 'sign_in_link';
  return is_sign_in_page(url) ? 'sign_in_page' : null;
}

// The page a tab is for: the one to save, to wake up on, and to go back to after sign-in. Null
// when nothing is known yet. Never a sign-in link, never the sign-in page, never a page of the
// app itself.
function read_address_to_come_back_to(page) {
  const url = parse_page(address_of_the_page(page));
  const before = without_sign_in_link(page.page_before_sign_in);
  if (!url) return before;
  if (holds_a_secret(url)) return before ?? `${url.origin}/`;
  if (is_sign_in_page(url)) {
    const wanted = url.searchParams.get('returnTo');
    return wanted?.startsWith('/') ? `${url.origin}${wanted}` : (before ?? `${url.origin}/`);
  }
  // "Sign out" sends the page to the first page of the server, and the server refuses it there.
  const was_sent_to_the_first_page = url.pathname === '/' && read_what_page_asks(page) === 'sign_in_link';
  return was_sent_to_the_first_page ? (before ?? url.href) : url.href;
}

function read_chat_id(address) {
  return /\/chats\/(ses_[a-z0-9]+)/.exec(parse_page(address)?.pathname ?? '')?.[1] ?? null;
}

const is_chat_page = (address) => {
  const pathname = parse_page(address)?.pathname ?? '';
  return pathname === '/chats' || pathname.startsWith('/chats/');
};

// "/scheduled-tasks/abc" is "Scheduled tasks". No name is kept anywhere: this one is read from
// the address each time, so a tab that has no page yet still has a name.
function read_name_from_path(address) {
  const pathname = parse_page(address)?.pathname;
  if (!pathname) return '';
  if (names_by_path[pathname]) return names_by_path[pathname];
  const [first_part = ''] = pathname.split('/').filter(Boolean);
  const words = first_part.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Alfera names a chat "Untitled session" until its first answer gives it a real title.
const readable_chat_title = (title) => (title && title !== 'Untitled session' ? title : '');

// The name of a tab. A chat is named by Alfera, or by its own page once that has loaded; until
// then its name is empty, and the strip shows a place for it. Any other page is named by its
// own title, or by its address while it has no page.
function read_tab_name({ page, page_title = '', chat_title = '' }) {
  const address = read_address_to_come_back_to(page);
  const shows_its_own_page = !page.address_that_failed && !read_what_page_asks(page);
  const own_title = shows_its_own_page ? page_title.replace(/\s*[·|-]\s*Alfera$/, '') : '';
  if (is_chat_page(address)) {
    return readable_chat_title(chat_title) || (titles_that_name_no_chat.includes(own_title) ? '' : own_title);
  }
  return names_by_path[parse_page(address)?.pathname] || own_title || read_name_from_path(address);
}

const is_server_error = (http_status) => http_status >= first_status_of_a_server_error;

function seconds_before_try(number_of_tries) {
  const index = Math.min(Math.max(number_of_tries, 1), seconds_before_each_new_try.length) - 1;
  return seconds_before_each_new_try[index];
}

module.exports = {
  parse_page,
  is_sign_in_link_address,
  without_sign_in_link,
  read_what_page_asks,
  read_address_to_come_back_to,
  read_chat_id,
  read_name_from_path,
  read_tab_name,
  is_server_error,
  seconds_before_try,
};
