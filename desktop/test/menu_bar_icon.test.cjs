const assert = require('node:assert/strict');
const { test } = require('node:test');
const { read_menu_bar_list } = require('../src/menu_bar_icon.cjs');

const chats = {
  ses_a: { title: 'Plan the week', state: 'needs_you' },
  ses_b: { title: 'x'.repeat(90), state: 'working' },
  ses_c: { title: '', state: 'working' },
  ses_d: { title: 'Read and done', state: 'done' },
  ses_e: { title: 'Quiet', state: null },
};
const read = (changes = {}) => {
  const opened = [];
  const actions = { open_chat: (id) => opened.push(id), open_quick_ask: () => opened.push('bar'), show_window: () => opened.push('window') };
  return { list: read_menu_bar_list({ sessions: chats, quick_ask_shortcut: 'Alt+Space', actions, ...changes }), opened };
};
const labels = (list) => list.rows.map((row) => row.label ?? row.type ?? row.role);

test('the number beside the icon counts the chats that need the person, and nothing else', () => {
  assert.equal(read().list.number, '1');
  assert.equal(read({ sessions: {} }).list.number, '');
  assert.equal(read({ sessions: { ses_b: chats.ses_b } }).list.number, '');
});

test('the words under the pointer say one chat, or more than one', () => {
  assert.equal(read().list.words_under_the_pointer, '1 chat needs you');
  const two = { ...chats, ses_f: { title: 'Another', state: 'needs_you' } };
  assert.equal(read({ sessions: two }).list.words_under_the_pointer, '2 chats need you');
  assert.equal(read({ sessions: {} }).list.words_under_the_pointer, 'Alfera');
});

test('the list has the chats that need the person, then the chats at work', () => {
  assert.deepEqual(labels(read().list), [
    'Needs you', 'Plan the week', 'separator',
    'Working', 'x'.repeat(60), 'Untitled chat', 'separator',
    'Ask Alfera…', 'Open Alfera', 'separator', 'quit',
  ]);
});

test('a part with no chat says so in a row that cannot be chosen', () => {
  const { list } = read({ sessions: {} });
  assert.deepEqual(list.rows.filter((row) => row.label === 'Nothing'), [
    { label: 'Nothing', enabled: false },
    { label: 'Nothing', enabled: false },
  ]);
});

test('a row opens its own chat', () => {
  const { list, opened } = read();
  list.rows.find((row) => row.label === 'Plan the week').click();
  list.rows.find((row) => row.label === 'Untitled chat').click();
  list.rows.find((row) => row.label === 'Open Alfera').click();
  assert.deepEqual(opened, ['ses_a', 'ses_c', 'window']);
});

test('the shortcut is shown only when macOS gave it to this app', () => {
  const row = (list) => list.rows.find((candidate) => candidate.label === 'Ask Alfera…');
  assert.equal(row(read().list).accelerator, 'Alt+Space');
  assert.equal('accelerator' in row(read({ quick_ask_shortcut: null }).list), false);
});
