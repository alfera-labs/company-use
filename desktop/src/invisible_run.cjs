const electron = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ALFERA_INVISIBLE=1 is for every run that a script starts: a check, a smoke run, a test. In such
// a run nothing of the app reaches the person at the Mac. No window is shown and none takes the
// keyboard. There is no Dock icon, no menu bar icon, no shortcut, no dialog, no sound and no
// notification. No link opens in a browser. The clipboard is a stand-in. The settings and the
// sign-in are in a folder of their own, so the app the person uses is never brought forward.
// Every place in the app that could do one of these goes through this file.
const is_invisible = process.env.ALFERA_INVISIBLE === '1';
const exit_code_for_a_window_that_showed = 70;
const exit_code_for_a_fault_in_the_app = 71;

// In an invisible run a window is never shown. What the app wanted to show is written down, so
// a check can see that the app would have brought a window up.
const titles_of_windows_the_app_wanted_to_show = [];

function show(window) {
  if (is_invisible) titles_of_windows_the_app_wanted_to_show.push(window.getTitle());
  else window.show();
}

function show_and_take_the_keyboard(window) {
  if (is_invisible) return void titles_of_windows_the_app_wanted_to_show.push(window.getTitle());
  window.show();
  window.focus();
}

// For a window, and for the page inside one.
function take_the_keyboard(window_or_page) {
  if (!is_invisible) window_or_page.focus();
}

// What a copy action writes to. The stand-in keeps the text, so a check can read it back.
const stand_in_clipboard = {
  text: '',
  writeText(text) {
    this.text = String(text);
  },
  readText() {
    return this.text;
  },
};
const clipboard = () => (is_invisible ? stand_in_clipboard : electron.clipboard);

const links_the_app_wanted_to_open = [];

function open_outside_the_app(target) {
  if (is_invisible) links_the_app_wanted_to_open.push(target);
  else electron.shell.openExternal(target);
}

function pop_up(menu) {
  if (!is_invisible) menu.popup();
}

// Called once, before the app is ready. A window that shows all the same is a fault in the app:
// it is hidden at once and the run ends, so a fault cannot keep a window on the screen.
function keep_the_run_invisible() {
  if (!is_invisible) return;
  const { app } = electron;
  app.dock?.hide();
  app.setActivationPolicy?.('accessory');
  // The keychain of the Mac is not asked for anything: asking can put a password dialog on the screen.
  app.commandLine.appendSwitch('use-mock-keychain');
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'alfera-invisible-')));
  }
  // No sound. And a page that is never shown still runs at full speed, so a check does not wait
  // on timers that a browser slows down in the background.
  app.on('web-contents-created', (_event, contents) => {
    contents.setAudioMuted(true);
    contents.setBackgroundThrottling(false);
  });
  // A fault in the app would put the error box of Electron on the screen. Here it goes to the
  // error output, and the run ends, so a check sees the fault and the person sees nothing.
  process.on('uncaughtException', (error) => {
    process.stderr.write(`The app threw in an invisible run. The run ends here.\n${error?.stack ?? error}\n`);
    app.exit(exit_code_for_a_fault_in_the_app);
  });
  app.on('browser-window-created', (_event, window) => {
    window.on('show', () => {
      window.hide();
      process.stderr.write('A window showed in an invisible run. The run ends here.\n');
      app.exit(exit_code_for_a_window_that_showed);
    });
  });
}

module.exports = {
  is_invisible,
  titles_of_windows_the_app_wanted_to_show,
  links_the_app_wanted_to_open,
  show,
  show_and_take_the_keyboard,
  take_the_keyboard,
  clipboard,
  open_outside_the_app,
  pop_up,
  keep_the_run_invisible,
};
