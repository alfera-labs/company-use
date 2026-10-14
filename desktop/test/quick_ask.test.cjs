const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  bar_window_options,
  create_question_sender,
  create_quick_ask,
  sentence_by_outcome,
} = require('../src/quick_ask/quick_ask.cjs');

// Stand-ins for Electron: they write down what the app asks of a window, and show nothing.
function load_quick_ask_with_a_stand_in_electron() {
  const asked = { windows: [], calls: [], listeners: {} };
  class StandInWindow {
    constructor(options) {
      this.options = options;
      this.is_visible = false;
      this.sent = [];
      this.webContents = { send: (...message) => this.sent.push(message) };
      asked.windows.push(this);
      return new Proxy(this, {
        get: (window, name) => {
          if (name in window) return window[name];
          return (...inputs) => asked.calls.push([name, ...inputs]);
        },
      });
    }
    isVisible() { return this.is_visible; }
    hide() { this.is_visible = false; }
    show() { this.is_visible = true; }
    on() {}
  }
  const electron = {
    BrowserWindow: StandInWindow,
    ipcMain: { on: (channel, listener) => (asked.listeners[channel] = listener) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1512, height: 982 } }),
    },
  };
  const electron_file = require.resolve('electron');
  const files = ['../src/quick_ask/quick_ask.cjs', '../src/invisible_run.cjs', '../src/alfera_api.cjs', '../src/settings.cjs'].map((file) => require.resolve(file));
  const before = require.cache[electron_file];
  for (const file of files) delete require.cache[file];
  require.cache[electron_file] = { id: electron_file, filename: electron_file, loaded: true, exports: electron };
  const quick_ask = require('../src/quick_ask/quick_ask.cjs');
  require.cache[electron_file] = before;
  for (const file of files) delete require.cache[file];
  return { quick_ask, asked };
}

test('the bar is a panel, so it floats over a full-screen app with no change to the kind of app', () => {
  assert.equal(bar_window_options.type, 'panel');
  assert.equal(bar_window_options.alwaysOnTop, true);
  assert.equal(bar_window_options.show, false);
});

test('the app never asks macOS to put the bar on every desktop: that call takes away the Dock icon and the menu bar', () => {
  const { quick_ask, asked } = load_quick_ask_with_a_stand_in_electron();
  quick_ask.create_quick_ask({ read_page: () => null, is_in_use: () => true, is_signed_in: () => true, open_chat: () => {} });
  assert.equal(asked.windows.length, 1);
  assert.deepEqual(asked.windows[0].options, quick_ask.bar_window_options);
  const calls_that_change_the_kind_of_app = ['setVisibleOnAllWorkspaces', 'setAlwaysOnTop', 'setActivationPolicy'];
  assert.deepEqual(asked.calls.filter(([name]) => calls_that_change_the_kind_of_app.includes(name)), []);
});

test('the shortcut does nothing before the person has said where their Alfera is, and while the setup shows', () => {
  const { quick_ask, asked } = load_quick_ask_with_a_stand_in_electron();
  let is_in_use = false;
  const bar = quick_ask.create_quick_ask({ read_page: () => null, is_in_use: () => is_in_use, is_signed_in: () => true, open_chat: () => {} });
  bar.toggle();
  assert.deepEqual(asked.windows[0].sent, []);
  is_in_use = true;
  bar.toggle();
  assert.deepEqual(asked.windows[0].sent, [['quick_ask:shown']]);
});

function create_sender({ answers, is_signed_in = true }) {
  const asked = [];
  const opened = [];
  const send = create_question_sender({
    ask: async (request) => {
      asked.push(request);
      return answers.shift();
    },
    is_signed_in: () => is_signed_in,
    open_chat: (session_id) => opened.push(session_id),
    create_id: () => 'message-1',
  });
  return { send, asked, opened };
}
const chat_made = { status: 201, body: { data: { session_id: 'ses_a' } } };
const taken = { status: 202, body: {} };

test('a question starts a chat, gives it the question, and opens it', async () => {
  const { send, asked, opened } = create_sender({ answers: [chat_made, taken] });
  assert.equal(await send('What is on today?'), 'sent');
  assert.deepEqual(asked.map((request) => request.path), ['/v1/sessions', '/v1/sessions/ses_a/queued-messages']);
  assert.deepEqual(asked[1].body, { message: 'What is on today?', client_message_id: 'message-1' });
  assert.deepEqual(opened, ['ses_a']);
});

test('a question typed while signed out is not sent and asks nothing of Alfera', async () => {
  const { send, asked, opened } = create_sender({ answers: [], is_signed_in: false });
  assert.equal(await send('What is on today?'), 'sign_in_first');
  assert.deepEqual([asked, opened], [[], []]);
});

test('Alfera says nobody is signed in: the person is told to sign in first', async () => {
  const { send, opened } = create_sender({ answers: [{ status: 401, body: null }] });
  assert.equal(await send('What is on today?'), 'sign_in_first');
  assert.deepEqual(opened, []);
});

test('no answer from Alfera opens no chat', async () => {
  const { send, opened } = create_sender({ answers: [{ status: 0, body: null }] });
  assert.equal(await send('What is on today?'), 'not_reachable');
  assert.deepEqual(opened, []);
});

test('a chat that did not take the question is not opened empty, and the next try uses the same chat', async () => {
  const { send, asked, opened } = create_sender({ answers: [chat_made, { status: 500, body: null }, taken] });
  assert.equal(await send('What is on today?'), 'not_taken');
  assert.deepEqual(opened, []);
  assert.equal(await send('What is on today?'), 'sent');
  assert.deepEqual(asked.map((request) => request.path), ['/v1/sessions', '/v1/sessions/ses_a/queued-messages', '/v1/sessions/ses_a/queued-messages']);
  assert.deepEqual(opened, ['ses_a']);
});

test('every way a question can fail has one sentence that says what to do', () => {
  for (const outcome of ['sign_in_first', 'not_reachable', 'not_taken']) {
    assert.match(sentence_by_outcome[outcome], /^[A-Z][^.]*\.( [A-Z][^.]*\.)?$/);
  }
  assert.equal(typeof create_quick_ask, 'function');
});
