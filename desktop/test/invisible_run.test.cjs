const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const source_folder = path.join(__dirname, '..', 'src');
const module_file = path.join(source_folder, 'invisible_run.cjs');

// The switch is read when the file loads, so each test loads the file again.
function load_with_switch(value) {
  delete require.cache[module_file];
  if (value === undefined) delete process.env.ALFERA_INVISIBLE;
  else process.env.ALFERA_INVISIBLE = value;
  return require(module_file);
}
afterEach(() => {
  delete process.env.ALFERA_INVISIBLE;
  delete require.cache[module_file];
});

// Counts what is asked of a window. The functions under test only pass the asking on, or do not.
function create_counting_window() {
  const asked = { show: 0, focus: 0, popup: 0 };
  return { asked, getTitle: () => 'A window', show: () => (asked.show += 1), focus: () => (asked.focus += 1), popup: () => (asked.popup += 1) };
}

test('in an invisible run no window is shown, none takes the keyboard, and no menu pops up', () => {
  const invisible_run = load_with_switch('1');
  const window = create_counting_window();
  invisible_run.show(window);
  invisible_run.show_and_take_the_keyboard(window);
  invisible_run.take_the_keyboard(window);
  invisible_run.pop_up(window);
  assert.equal(invisible_run.is_invisible, true);
  assert.deepEqual(window.asked, { show: 0, focus: 0, popup: 0 });
  // What the app wanted to show is written down, so a check can see it.
  assert.deepEqual(invisible_run.titles_of_windows_the_app_wanted_to_show, ['A window', 'A window']);
});

test('in an invisible run the clipboard is a stand-in that keeps what is copied', () => {
  const invisible_run = load_with_switch('1');
  invisible_run.clipboard().writeText('the public key');
  assert.equal(invisible_run.clipboard().readText(), 'the public key');
  assert.notEqual(invisible_run.clipboard(), require('electron').clipboard);
});

test('in an invisible run a link is not handed to the browser', () => {
  const invisible_run = load_with_switch('1');
  assert.doesNotThrow(() => invisible_run.open_outside_the_app('https://example.com'));
});

test('without the switch, and with any other value, the app shows as always', () => {
  for (const value of [undefined, '', '0', 'yes']) {
    const invisible_run = load_with_switch(value);
    const window = create_counting_window();
    invisible_run.show(window);
    invisible_run.show_and_take_the_keyboard(window);
    invisible_run.take_the_keyboard(window);
    invisible_run.pop_up(window);
    assert.equal(invisible_run.is_invisible, false);
    assert.deepEqual(window.asked, { show: 2, focus: 2, popup: 1 });
  }
});

// ---- the whole app goes through that one file --------------------------------------------------
const files_of_the_main_process = fs
  .readdirSync(source_folder, { recursive: true })
  .filter((file) => file.endsWith('.cjs') && !file.endsWith('preload.cjs') && file !== 'invisible_run.cjs');
const read = (file) => fs.readFileSync(path.join(source_folder, file), 'utf8');

// Calls that put something in front of the person. Outside invisible_run.cjs there is none.
const calls_only_the_switch_may_make = [
  /\.show\(\)/, /\.showInactive\(/, /\.focus\(\)/, /\.moveTop\(/, /setAlwaysOnTop\(/, /app\.focus\(/,
  /app\.dock/, /requestUserAttention/, /new Notification/, /\.beep\(/, /openExternal\(/, /\.popup\(/,
  /\bclipboard\.(?:write|read)/, /electron\.clipboard/, /setActivationPolicy/,
];

test('no file of the app shows, focuses, pops up, beeps, opens a browser or uses the clipboard by itself', () => {
  for (const file of files_of_the_main_process) {
    const lines = read(file).split('\n').filter((line) => !/^\s*\/\//.test(line) && !/\bapp\.dock\?\.setBadge\b/.test(line));
    for (const call of calls_only_the_switch_may_make) {
      const found = lines.find((line) => call.test(line));
      assert.equal(found, undefined, `${file} holds ${call}: ${found}`);
    }
  }
});

// Calls that stay where they are, each behind the switch.
test('the menu bar icon, the number on the Dock, the shortcut and the dialogs are behind the switch', () => {
  const guarded_by_an_early_return = { 'menu_bar_icon.cjs': [/new Tray\(/, /setBadge\(/], 'folder/folder_work.cjs': [/dialog\.show/] };
  for (const [file, calls] of Object.entries(guarded_by_an_early_return)) {
    const text = read(file);
    const guard = text.search(/if \(is_invisible\) return/);
    assert.notEqual(guard, -1, `${file} has the guard`);
    for (const call of calls) assert.ok(text.search(call) > guard, `${file}: ${call} comes after the guard`);
  }
  const shortcut = read('main.cjs').split('\n').find((line) => line.includes('globalShortcut.register('));
  assert.match(shortcut, /!is_invisible && globalShortcut\.register\(/);
  const every_file = files_of_the_main_process.map(read).join('\n');
  assert.equal(every_file.match(/new Tray\(/g).length, 1);
  assert.equal(every_file.match(/globalShortcut\.register\(/g).length, 1);
  assert.equal(every_file.match(/dialog\.show/g).length, 3);
});

test('an invisible run allows no page a notification or the clipboard', () => {
  assert.match(read('main.cjs'), /decide\(!is_invisible && from_alfera && is_allowed\)/);
});

test('every window is made hidden, and shown only through the switch', () => {
  for (const file of files_of_the_main_process) {
    const text = read(file);
    for (const made of text.matchAll(/new BrowserWindow\(\{[\s\S]*?\n  \}\);/g)) {
      assert.match(made[0], /show: false/, `${file}: a window is made hidden`);
    }
  }
  // The bar of the quick ask is made from a record of its own.
  const every_file = files_of_the_main_process.map(read).join('\n');
  assert.equal(every_file.match(/new BrowserWindow\(/g).length, 2);
  assert.match(read('quick_ask/quick_ask.cjs'), /new BrowserWindow\(bar_window_options\)/);
  assert.match(read('quick_ask/quick_ask.cjs'), /const bar_window_options = \{[\s\S]*?\n  show: false,/);
});

test('a fault in the app during an invisible run ends the run: the error box of Electron never shows', () => {
  const text = fs.readFileSync(path.join(source_folder, 'invisible_run.cjs'), 'utf8');
  assert.match(text, /process\.on\('uncaughtException'/);
  assert.match(text, /app\.exit\(exit_code_for_a_fault_in_the_app\)/);
});

test('a smoke run that is not invisible ends before the app starts', () => {
  const main = read('main.cjs');
  assert.ok(main.indexOf('if (smoke_test && !is_invisible)') < main.indexOf('app.whenReady()'));
  assert.ok(main.indexOf('keep_the_run_invisible();') < main.indexOf('app.requestSingleInstanceLock()'));
});
