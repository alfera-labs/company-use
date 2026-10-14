const { BrowserWindow, ipcMain, screen } = require('electron');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { ask_alfera_as_the_signed_in_person } = require('../alfera_api.cjs');
const { show } = require('../invisible_run.cjs');

const bar_size = { width: 640, height: 64 };

// The bar is a panel: on a Mac, a panel floats over the app in front, also over an app in full
// screen, and does not make this app the one in front. Nothing else is asked of macOS for that.
// The call that puts a window on every desktop is not made: it turns the whole app into one with
// no Dock icon and no menu bar.
const bar_window_options = {
  ...bar_size,
  type: 'panel',
  show: false,
  frame: false,
  resizable: false,
  movable: false,
  fullscreenable: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  vibrancy: 'popover',
  visualEffectState: 'active',
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, 'quick_ask_preload.cjs'),
  },
};

// What the bar says when a question did not start a chat. The question stays in the bar.
const sentence_by_outcome = {
  sign_in_first: 'Sign in to Alfera first, then press Return again.',
  not_reachable: 'Alfera did not answer. Check your connection, then press Return again.',
  not_taken: 'Alfera did not take the question. Press Return to send it again.',
};
const status_when_nobody_is_signed_in = 401;
const is_taken = (answer) => answer.status >= 200 && answer.status < 300;

// Starts a chat with one question. `ask` is the call to Alfera as the signed-in person. Returns
// "sent", or the name of what went wrong. A chat that was made and did not get its question is
// used for the next try, so a second press does not leave an empty chat behind.
function create_question_sender({ ask, is_signed_in, open_chat, create_id = randomUUID }) {
  let chat_that_waits_for_its_question = null;

  const read_what_went_wrong = (answer) => {
    if (answer.status === status_when_nobody_is_signed_in) return 'sign_in_first';
    return answer.status === 0 ? 'not_reachable' : 'not_taken';
  };

  async function create_chat() {
    const created = await ask({ method: 'POST', path: '/v1/sessions', body: {} });
    const session_id = created.body?.data?.session_id;
    if (is_taken(created) && session_id) return { session_id };
    return { problem: is_taken(created) ? 'not_taken' : read_what_went_wrong(created) };
  }

  return async function send_question(question) {
    if (!is_signed_in()) return 'sign_in_first';
    const chat = chat_that_waits_for_its_question ?? (await create_chat());
    if (chat.problem) return chat.problem;
    chat_that_waits_for_its_question = chat;
    const queued = await ask({
      method: 'POST',
      path: `/v1/sessions/${chat.session_id}/queued-messages`,
      body: { message: question, client_message_id: create_id() },
    });
    if (!is_taken(queued)) return read_what_went_wrong(queued);
    chat_that_waits_for_its_question = null;
    open_chat(chat.session_id);
    return 'sent';
  };
}

// A small bar over any app. The person types one thing and presses Return: the question starts a
// new chat, and that chat opens in a tab. The bar goes away only when the chat has the question.
// The answer shows in the tab, not in the bar. Show it in the bar when the app listens
// to Alfera's live events.
function create_quick_ask({ read_page, is_in_use, is_signed_in, open_chat }) {
  const bar = new BrowserWindow(bar_window_options);
  bar.loadFile(path.join(__dirname, 'quick_ask.html'));
  const send_question = create_question_sender({
    ask: (request) => ask_alfera_as_the_signed_in_person(read_page(), request),
    is_signed_in,
    open_chat,
  });

  function show_on_the_screen_with_the_pointer() {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    bar.setPosition(
      Math.round(workArea.x + (workArea.width - bar_size.width) / 2),
      Math.round(workArea.y + workArea.height * 0.22),
    );
    bar.webContents.send('quick_ask:shown');
    show(bar);
  }

  // Before the person has said where their Alfera is, and while the setup shows, there is
  // nothing to ask.
  function toggle() {
    if (bar.isVisible()) return bar.hide();
    if (is_in_use()) show_on_the_screen_with_the_pointer();
  }

  async function send_and_tell_the_bar(question) {
    const text = String(question).trim();
    if (!text) return;
    const outcome = await send_question(text).catch(() => 'not_reachable');
    if (outcome === 'sent') bar.hide();
    bar.webContents.send('quick_ask:outcome', outcome, sentence_by_outcome[outcome] ?? '');
  }

  ipcMain.on('quick_ask:hide', () => bar.hide());
  ipcMain.on('quick_ask:send', (_event, question) => send_and_tell_the_bar(question));
  bar.on('blur', () => bar.hide());

  return { toggle, send_question };
}

module.exports = { create_quick_ask, create_question_sender, bar_window_options, sentence_by_outcome };
