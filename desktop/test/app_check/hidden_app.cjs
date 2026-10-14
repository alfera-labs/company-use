// Starts one invisible copy of the app for a check and drives it: it asks the main process
// through the port Node opens for a debugger, and the pages through the port Chromium opens.
// Nothing is ever on the screen (src/invisible_run.cjs).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start_invisible_app } = require('../invisible_electron.cjs');

const pages_port = 9387;
const main_port = 9388;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function ask(socket_address, method, params) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socket_address);
    const timer = setTimeout(() => { socket.close(); reject(new Error('no answer in 15 seconds')); }, 15000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result);
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('the connection closed')); };
  });
}

async function evaluate(port, find_target, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) })).json();
  const target = targets.find(find_target);
  if (!target) throw new Error('no such page');
  const result = await ask(target.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(`threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}

// Names every expression in the main process can use.
const names_in_main = `
  const electron = process.mainModule.require('electron');
  const invisible_run = process.mainModule.require(electron.app.getAppPath() + '/src/invisible_run.cjs');
  const the_window = () => electron.BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('shell.html'));
  const the_bar = () => electron.BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('quick_ask.html'));
  const pages_shown = () => the_window().contentView.children.filter((view) => view.webContents && view.getVisible() && view.getBounds().height > 0).map((view) => view.webContents);
  const is_setup = (contents) => contents.getURL().endsWith('setup.html');
  const front_tab_page = () => pages_shown().filter((contents) => !is_setup(contents)).at(-1);
  const rows_of_the_menus = () => electron.Menu.getApplicationMenu().items.flatMap((menu) => menu.submenu?.items ?? []).filter((row) => !row.role && !row.submenu && row.type !== 'separator');
`;

const is_strip = (target) => target.url.endsWith('/src/window/shell.html');
const is_setup = (target) => target.url.endsWith('/src/setup/setup.html');
const is_bar = (target) => target.url.endsWith('/src/quick_ask/quick_ask.html');

// `settings` is what the app finds in its settings file when it starts; none is a first run.
function start_hidden_app({ settings = null, environment = {} } = {}) {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'alfera-app-check-'));
  const profile = path.join(folder, 'profile');
  const settings_file = path.join(profile, 'settings.json');
  const errors_file = path.join(folder, 'errors.txt');
  fs.mkdirSync(profile, { recursive: true });
  if (settings) fs.writeFileSync(settings_file, JSON.stringify(settings));
  const errors = fs.openSync(errors_file, 'w');
  const process_of_the_app = start_invisible_app({
    switches: [`--inspect=${main_port}`, `--remote-debugging-port=${pages_port}`, `--user-data-dir=${profile}`],
    environment,
    stdio: ['ignore', 'ignore', errors],
  });
  let exit_code = null;
  const has_ended = new Promise((resolve) => process_of_the_app.once('exit', (code) => resolve((exit_code = code ?? 1))));

  const in_main = (expression) => evaluate(main_port, () => true, `(async () => { ${names_in_main} return (${expression}); })()`);
  const in_page = (find_target, expression) => evaluate(pages_port, find_target, expression);
  const in_front_tab = (expression) => in_main(`front_tab_page().executeJavaScript(${JSON.stringify(expression)}, true)`);
  const read_settings = () => (fs.existsSync(settings_file) ? JSON.parse(fs.readFileSync(settings_file, 'utf8')) : {});
  const read_errors = () => fs.readFileSync(errors_file, 'utf8');

  async function stop() {
    process_of_the_app.kill();
    const quit_in_time = await Promise.race([has_ended.then(() => true), wait(5000).then(() => false)]);
    if (!quit_in_time) process_of_the_app.kill('SIGKILL');
    await has_ended;
  }

  // What macOS says, asked with a command that reads and shows nothing.
  function read_what_macos_says() {
    const read = (...words) => execFileSync('lsappinfo', words, { encoding: 'utf8' }).trim();
    const this_app = read('find', `pid=${process_of_the_app.pid}`);
    return { is_in_front: this_app !== '' && read('front') === this_app, kind: this_app ? read('info', '-only', 'ApplicationType', this_app) : '' };
  }

  return {
    profile,
    in_main,
    in_page,
    in_front_tab,
    read_settings,
    read_errors,
    read_what_macos_says,
    read_exit_code: () => exit_code,
    stop,
    end_now: () => process_of_the_app.kill('SIGKILL'),
    remove_files: () => fs.rmSync(folder, { recursive: true, force: true }),
  };
}

module.exports = { start_hidden_app, wait, is_strip, is_setup, is_bar };
