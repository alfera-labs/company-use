const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  is_server_error,
  read_address_to_come_back_to,
  read_chat_id,
  read_name_from_path,
  read_tab_name,
  read_what_page_asks,
  seconds_before_try,
  without_sign_in_link,
} = require('../src/window/tab_pages.cjs');

const server = 'https://alfera.example.com';
const chat = `${server}/chats/ses_0000000001`;

test('a tab whose page has not loaded yet has no address, and nothing here throws', () => {
  // The crash after sign out and sign in: a tab that was refused, slept, and woke with an empty page.
  for (const address of ['', null, undefined, 'about:blank', 'chrome-error://chromewebdata/']) {
    const page = { address, http_status: 401, page_before_sign_in: chat };
    assert.equal(read_what_page_asks(page), null, String(address));
    assert.equal(read_address_to_come_back_to(page), chat, String(address));
    assert.equal(read_tab_name({ page, chat_title: 'Invoices' }), 'Invoices', String(address));
    const nothing_known = { address, http_status: null, page_before_sign_in: null };
    assert.equal(read_address_to_come_back_to(nothing_known), null);
    assert.equal(read_tab_name({ page: nothing_known }), '');
    assert.equal(read_chat_id(address), null);
  }
});

test('a page a link-server refused asks for a sign-in link, and the tab is still for that page', () => {
  const page = { address: chat, http_status: 401, page_before_sign_in: null };
  assert.equal(read_what_page_asks(page), 'sign_in_link');
  assert.equal(read_address_to_come_back_to(page), chat);
});

test('a link that is used up asks for a new one; a link that opened asks for nothing', () => {
  const link = `${server}/join/a-token`;
  assert.equal(read_what_page_asks({ address: link, http_status: 404 }), 'new_sign_in_link');
  assert.equal(read_what_page_asks({ address: link, http_status: 200 }), null);
});

test('a server with a sign-in page of its own asks for nothing from the app', () => {
  const page = { address: `${server}/sign-in?returnTo=%2Fchats%2Fses_0000000001`, http_status: 200 };
  assert.equal(read_what_page_asks(page), 'sign_in_page');
  assert.equal(read_address_to_come_back_to(page), chat);
  assert.equal(read_address_to_come_back_to({ address: `${server}/sign-in`, page_before_sign_in: chat }), chat);
  assert.equal(read_address_to_come_back_to({ address: `${server}/sign-in?returnTo=https://elsewhere.example.com` }), `${server}/`);
});

test('a sign-in link is never the page a tab is for, and its token is never kept', () => {
  const link = `${server}/join/a-secret-token`;
  assert.equal(read_address_to_come_back_to({ address: link, http_status: 200, page_before_sign_in: chat }), chat);
  assert.equal(read_address_to_come_back_to({ address: link, http_status: 200 }), `${server}/`);
  assert.equal(read_address_to_come_back_to({ address: '', address_that_failed: link }), `${server}/`);
  assert.equal(read_address_to_come_back_to({ address: chat, page_before_sign_in: link }), chat);
  assert.equal(read_address_to_come_back_to({ address: '', page_before_sign_in: link }), `${server}/`);
  assert.equal(without_sign_in_link(link), `${server}/`);
  assert.equal(without_sign_in_link(chat), chat);
  assert.equal(without_sign_in_link('file:///Applications/Alfera.app/x.html'), null);
  assert.equal(without_sign_in_link(`${server}/setup#token=a-setup-token`), `${server}/`);
  assert.equal(read_address_to_come_back_to({ address: `${server}/setup#token=a-setup-token`, http_status: 200 }), `${server}/`);
  assert.equal(read_address_to_come_back_to({ address: `${server}/setup`, http_status: 200 }), `${server}/setup`);
});

test('while the "cannot be reached" page shows, the tab is for the page that did not load', () => {
  const page = { address: 'file:///Applications/Alfera.app/src/unreachable.html?host=x', address_that_failed: chat, http_status: 401 };
  assert.equal(read_address_to_come_back_to(page), chat);
  assert.equal(read_what_page_asks(page), null);
  assert.equal(read_tab_name({ page, page_title: 'Alfera', chat_title: 'Invoices' }), 'Invoices');
  const inbox = { address: 'file:///x/src/unreachable.html', address_that_failed: `${server}/inbox` };
  assert.equal(read_tab_name({ page: inbox, page_title: 'Alfera' }), 'Inbox');
});

test('a chat is named by Alfera or by its page, and by nothing else', () => {
  const page = { address: chat, http_status: 200 };
  assert.equal(read_tab_name({ page, page_title: 'Chats · Alfera', chat_title: 'Invoices' }), 'Invoices');
  assert.equal(read_tab_name({ page, page_title: 'Chats · Alfera', chat_title: 'Untitled session' }), '');
  assert.equal(read_tab_name({ page, page_title: 'Chats · Alfera' }), '');
  assert.equal(read_tab_name({ page: { address: `${server}/chats` }, page_title: 'New chat' }), '');
  assert.equal(read_tab_name({ page, page_title: 'Plan for March · Alfera' }), 'Plan for March');
});

test('a tab that asks for sign-in never takes the name of the page that asks', () => {
  const refused = { address: chat, http_status: 401 };
  assert.equal(read_tab_name({ page: refused, page_title: 'This Alfera needs a sign-in link' }), '');
  const inbox = { address: `${server}/inbox`, http_status: 401 };
  assert.equal(read_tab_name({ page: inbox, page_title: 'This Alfera needs a sign-in link' }), 'Inbox');
});

test('a page that is not a chat has a name with no page at all, read from its address', () => {
  assert.equal(read_name_from_path(`${server}/inbox`), 'Inbox');
  assert.equal(read_name_from_path(`${server}/scheduled-tasks/abc`), 'Scheduled tasks');
  assert.equal(read_name_from_path(`${server}/settings/profile`), 'Settings');
  assert.equal(read_name_from_path(`${server}/home`), 'New chat');
  assert.equal(read_name_from_path(''), '');
  assert.equal(read_tab_name({ page: { address: `${server}/settings/team` } }), 'Settings');
  assert.equal(read_tab_name({ page: { address: `${server}/settings/team` }, page_title: 'Team · Settings · Alfera' }), 'Team · Settings');
  assert.equal(read_tab_name({ page: { address: `${server}/home` }, page_title: 'Home · Alfera' }), 'New chat');
});

test('the chat of an address', () => {
  assert.equal(read_chat_id(chat), 'ses_0000000001');
  assert.equal(read_chat_id(`${server}/inbox`), null);
});

test('a server error is 500 and up; the wait before a new try grows to a minute and stays there', () => {
  assert.deepEqual([200, 401, 404, 499, 500, 502].map(is_server_error), [false, false, false, false, true, true]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 60].map(seconds_before_try), [5, 5, 10, 20, 40, 60, 60, 60]);
});

// "Sign out" sends the page to the first page of the server, which then asks for a link. The
// tab is still for the page the person was on.
test('a tab that was sent to the first page of the server and refused there is still for the page it showed before', () => {
  const server = 'https://alfera.example.com';
  const signed_out = { address: `${server}/`, http_status: 401, address_that_failed: null, page_before_sign_in: `${server}/scheduled-tasks` };
  assert.equal(read_address_to_come_back_to(signed_out), `${server}/scheduled-tasks`);
  assert.equal(read_address_to_come_back_to({ ...signed_out, page_before_sign_in: null }), `${server}/`);
});

test('a tab that was refused on a page of its own is for that page', () => {
  const server = 'https://alfera.example.com';
  const refused = { address: `${server}/inbox`, http_status: 401, address_that_failed: null, page_before_sign_in: `${server}/home` };
  assert.equal(read_address_to_come_back_to(refused), `${server}/inbox`);
});
