// `npm run check-setup`: drives the real app through the guided setup, screen by screen, the way
// a person would, once for each way a setup can go. The app runs as it ships. The one thing
// replaced is ssh: the file `ssh` in this folder is first on the PATH of the run, connects to
// nothing, and answers what scenarios.cjs says. A small web server on this Mac stands in for the
// installed Alfera, so the sign-in link at the end has something to open: the app is started
// with two switches that send the name of the server to it and accept its certificate.
// It exits 0 only when every screen of every run showed the state it must show.
// Nothing of it reaches the person at the Mac: no window shows, nothing takes the keyboard, and
// the clipboard is left alone. Each run asks the app itself whether that holds, and the whole
// check stops at once when it does not. Without ALFERA_INVISIBLE=1 it does not start.
//   ALFERA_INVISIBLE=1 node test/setup_check/check_setup.mjs [name of one run]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { start_invisible_app, stop_unless_the_run_is_invisible } = require('../invisible_electron.cjs');
stop_unless_the_run_is_invisible('The setup check');
const { install_dir, sentences, sign_in_token } = require('./scenarios.cjs');
const { press_authorize, start_stand_in_digitalocean } = require('./stand_in_digitalocean.cjs');
const { aws_console_link, setup_token, start_stand_in_deploy_page } = require('./stand_in_deploy_page.cjs');
const { words_by_reason } = require('../../src/setup/make_server_for_me.cjs');
const { usual_time_for_the_install, words_of_the_app_by_reason } = require('../../src/setup/installer_contract.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const app_folder = path.resolve(here, '../..');
const debugging_port = 9377;
const port_of_the_app_itself = 9378;
const server_address_typed = '203.0.113.7';
const name_of_the_server = '203-0-113-7.sslip.io';
const address_of_the_server = `https://${name_of_the_server}`;
// The stand-in server also stands in for the place the installer comes from.
const installer_address = `${address_of_the_server}/installer`;
const key_typed = 'sk-stand-in-key-for-the-check-0000000001';
const key_on_stdin = `MODEL_KEY=${key_typed}\n`;
const seconds_to_wait_for_a_screen = 20;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class WrongScreen extends Error {}
class SomethingShowed extends Error {}

function check(is_right, what, seen = '') {
  if (!is_right) throw new WrongScreen(`${what}${seen === '' ? '' : `\n      seen: ${JSON.stringify(seen)}`}`);
}

// ---- the stand-in for the installed Alfera ---------------------------------------------------

// It answers under the name the app asked the installer for, with a certificate made for this
// run. No authority signed it; the app is started so that it accepts it.
function start_stand_in_server() {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'alfera-setup-check-server-'));
  const [key, certificate] = ['key.pem', 'certificate.pem'].map((name) => path.join(folder, name));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=${name_of_the_server}`, '-keyout', key, '-out', certificate], { stdio: 'ignore' });
  // The sign-in link opens a page. The first page is the sign-in page of a server that has one
  // of its own. Every other page asks for a sign-in link, as a server with links does.
  const pages = {
    [`/join/${sign_in_token}`]: 'Join the stand-in workspace',
    '/': 'Sign in',
    '/setup': 'Set up Alfera',
    '/installer/install.sh': 'The installer',
  };
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(certificate) }, (request, response) => {
    const title = pages[request.url];
    response.writeHead(title ? 200 : 401, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end(`<title>${title ?? 'This Alfera needs a sign-in link'}</title>`);
  });
  fs.rmSync(folder, { recursive: true, force: true });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---- the app, driven through the debugging port of its pages ---------------------------------

// An app that does not answer in three seconds counts as an app with no page.
async function list_pages() {
  const answer = await fetch(`http://127.0.0.1:${debugging_port}/json`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  return answer ? answer.json().catch(() => []) : [];
}

function ask_page(page, method, params) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    setTimeout(() => reject(new Error('the page did not answer')), 5000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onmessage = (event) => {
      socket.close();
      resolve(JSON.parse(event.data).result);
    };
    socket.onerror = () => reject(new Error('the page closed'));
  });
}

const is_setup_page = (page) => page.url.endsWith('/src/setup/setup.html');
const is_strip_page = (page) => page.url.endsWith('/src/window/shell.html');
const is_deploy_page = (page) => URL.parse(page.url)?.pathname === '/deploy';

async function count_tabs_in_the_strip() {
  const strip = (await list_pages()).find(is_strip_page);
  if (!strip) return null;
  const result = await ask_page(strip, 'Runtime.evaluate', { expression: `document.querySelectorAll('.tab').length`, returnByValue: true }).catch(() => null);
  return result?.result?.value ?? null;
}

// Asks the main process of the app, through the port Node opens for a debugger.
async function ask_the_app(expression) {
  const answer = await fetch(`http://127.0.0.1:${port_of_the_app_itself}/json`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  const [target] = answer ? await answer.json().catch(() => []) : [];
  if (!target) return null;
  const result = await ask_page(target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
  return result?.result?.value ?? null;
}

const what_the_app_says_it_shows = () =>
  ask_the_app(`(() => {
    const electron = process.mainModule.require('electron');
    const invisible_run = process.mainModule.require(electron.app.getAppPath() + '/src/invisible_run.cjs');
    return {
      windows_that_show: electron.BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length,
      a_window_has_the_keyboard: electron.BrowserWindow.getFocusedWindow() !== null,
      dock_icon_shows: electron.app.dock.isVisible(),
      clipboard_is_the_stand_in: invisible_run.clipboard() !== electron.clipboard,
      text_on_the_stand_in_clipboard: invisible_run.clipboard().readText(),
    };
  })()`);

// What macOS says, asked with a command that reads and shows nothing: the kind of app this is,
// and whether it is the app in front.
function what_macos_says(pid) {
  const read = (...words) => execFileSync('lsappinfo', words, { encoding: 'utf8' });
  const this_app = read('find', `pid=${pid}`).trim();
  return {
    kind_of_app: this_app ? read('info', '-only', 'ApplicationType', this_app).trim() : 'not an app macOS lists',
    is_in_front: this_app !== '' && read('front').trim() === this_app,
  };
}

// The rule of the whole check. When it is broken the app is ended before anything else.
async function see_that_nothing_shows(app, when) {
  const says = await what_the_app_says_it_shows();
  const macos = what_macos_says(app.pid);
  const nothing_shows =
    says !== null &&
    says.windows_that_show === 0 &&
    !says.a_window_has_the_keyboard &&
    !says.dock_icon_shows &&
    says.clipboard_is_the_stand_in &&
    !macos.is_in_front &&
    macos.kind_of_app !== '"ApplicationType"="Foreground"';
  if (nothing_shows) return says;
  app.end_now();
  throw new SomethingShowed(`${when}: the app is not invisible\n      ${JSON.stringify({ ...says, ...macos })}`);
}

async function run_in_setup_page(expression) {
  const page = (await list_pages()).find(is_setup_page);
  if (!page) return null;
  const result = await ask_page(page, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
  return result?.result?.value ?? null;
}

const read_screen = () =>
  run_in_setup_page(`(() => {
    const screen = document.querySelector('main');
    const texts = (selector) => [...screen.querySelectorAll(selector)].map((element) => element.textContent);
    // A page that is never on the screen draws no frame, so a step would stay at the start of
    // its short move into place. The move is ended here, as it has ended when a person looks.
    // A ring that turns has no end, and cannot be ended.
    for (const move of document.getAnimations()) { try { move.finish(); } catch {} }
    return {
      step: screen.dataset.step,
      state: screen.dataset.state,
      title: screen.querySelector('h1')?.textContent,
      lead: screen.querySelector('.lead')?.textContent,
      problems: texts('.problem:not(:empty)'),
      problem_holds_a_tag: Boolean(screen.querySelector('.problem *')),
      note: screen.querySelector('.note')?.textContent ?? null,
      buttons: texts('button:not(.back)'),
      has_back: Boolean(screen.querySelector('button.back')),
      scrolled_by: Math.round(scrollY),
      top_of_the_first_thing: Math.round(screen.firstElementChild.getBoundingClientRect().top),
      room_to_scroll: document.documentElement.scrollHeight - innerHeight,
      height_of_the_step: Math.round(screen.getBoundingClientRect().height),
      height_of_the_window: innerHeight,
      words_of_the_rows: texts('section h2, section p'),
      filled_buttons: texts('button.main_choice'),
      lines: texts('.lines li'),
      lines_are_numbered: Boolean(screen.querySelector('ol.lines')),
      copied_text: screen.querySelector('.copied_text code')?.textContent ?? null,
      rows: [...screen.querySelectorAll('.progress li')].map((row) => row.dataset.state),
      timing: screen.querySelector('.timing')?.textContent ?? null,
      field: screen.querySelector('input')?.value ?? null,
      field_is_masked: screen.querySelector('input')?.type === 'password',
      focus: document.activeElement?.textContent || document.activeElement?.ariaLabel || null,
    };
  })()`).then(async (screen) => (screen ? { ...screen, tabs_in_the_strip: await count_tabs_in_the_strip() } : null));

// Waits until the screen is the one wanted, and returns it. `wanted` holds the step, and the
// state when it matters. A value can be a function that says whether what it is given is right.
async function see(wanted, what) {
  let screen = null;
  for (let waited = 0; waited < seconds_to_wait_for_a_screen * 10; waited += 1) {
    screen = await read_screen();
    const is_it = screen && Object.entries(wanted).every(([name, value]) => (typeof value === 'function' ? value(screen[name]) : screen[name] === value));
    if (is_it) return screen;
    await wait(100);
  }
  throw new WrongScreen(`${what}: the screen did not show\n      seen: ${JSON.stringify(screen)}`);
}

// The click happens a moment later, so the answer of this call is back before a click that
// closes the window.
const press = (label) =>
  run_in_setup_page(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    setTimeout(() => button.click(), 30);
    return true;
  })()`).then((pressed) => check(pressed, `the button "${label}" is there to press`));

const type = (text) =>
  run_in_setup_page(`(() => { document.querySelector('input').value = ${JSON.stringify(text)}; return true; })()`);

const press_escape = () => run_in_setup_page(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; })()`);

// "Change Address…" in the Alfera menu, chosen the way the menu chooses it.
const choose_change_address = () =>
  ask_the_app(`(() => {
    const electron = process.mainModule.require('electron');
    const rows = electron.Menu.getApplicationMenu().items.flatMap((menu) => menu.submenu?.items ?? []);
    rows.find((row) => row.label === 'Change Address…').click();
    return true;
  })()`);

// Sends the tab of the app to another page of the stand-in server.
const send_the_tab_to = (page_address) =>
  ask_the_app(`(() => {
    const electron = process.mainModule.require('electron');
    const tab = electron.webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(${JSON.stringify(address_of_the_server)}));
    tab.loadURL(${JSON.stringify(page_address)});
    return true;
  })()`);

// ---- one run of the app ----------------------------------------------------------------------

async function start_app(scenario_name, port_of_the_stand_in_server, environment = {}) {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'alfera-setup-check-'));
  const profile = path.join(folder, 'profile');
  const record_file = path.join(folder, 'calls.jsonl');
  const switches_for_the_stand_in_server = [`--host-rules=MAP ${name_of_the_server} 127.0.0.1:${port_of_the_stand_in_server}`, '--ignore-certificate-errors'];
  const app = start_invisible_app({
    switches: [`--inspect=${port_of_the_app_itself}`, `--remote-debugging-port=${debugging_port}`, `--user-data-dir=${profile}`, ...switches_for_the_stand_in_server],
    environment: {
      PATH: `${here}:${process.env.PATH}`,
      ALFERA_STAND_IN_SCENARIO: scenario_name,
      ALFERA_STAND_IN_RECORD: record_file,
      ALFERA_STAND_IN_ADDRESS: address_of_the_server,
      ALFERA_INSTALLER_ADDRESS: installer_address,
      ...environment,
    },
  });
  const read_calls = () =>
    fs.existsSync(record_file)
      ? fs.readFileSync(record_file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
  // An app that does not quit when asked is ended, so one stuck run cannot hold up the rest.
  const stop = async () => {
    const has_quit = new Promise((resolve) => app.once('exit', resolve));
    app.kill();
    const quit_in_time = await Promise.race([has_quit.then(() => true), wait(5000).then(() => false)]);
    if (!quit_in_time) app.kill('SIGKILL');
    await has_quit;
    fs.rmSync(folder, { recursive: true, force: true });
  };
  return { profile, read_calls, stop, stand_in_address: address_of_the_server, pid: app.pid, end_now: () => app.kill('SIGKILL') };
}

function read_saved_address(app) {
  const file = path.join(app.profile, 'settings.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).address : undefined;
}

function read_every_file_under(folder) {
  return fs.readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// ---- the screens, in order -------------------------------------------------------------------

async function walk_to_the_address_screen(app) {
  const first = await see({ step: 'where', state: 'idle' }, 'first run');
  await see_that_nothing_shows(app, 'at the first screen');
  check(first.filled_buttons.length === 1 && first.filled_buttons[0] === 'Use Alfera Cloud', 'the first screen has one filled button, for Alfera Cloud', first.filled_buttons);
  check(first.buttons.includes('I already have an Alfera server'), 'the first screen has the quiet link for a server that exists', first.buttons);
  check(first.focus === 'Use Alfera Cloud', 'the keyboard is on the main button', first.focus);
  check(first.lead === 'You can change this later: in the menu bar, choose Alfera, then "Change Address…".', 'the first screen says where to change the choice', first.lead);
  check(first.tabs_in_the_strip === 0, 'the strip shows no tab during the setup', first.tabs_in_the_strip);
  await press('I will do it myself');

  const needs = await see({ step: 'what_you_need', state: 'idle' }, 'screen 1');
  check(needs.lines.length === 2, 'screen 1 names two things', needs.lines);
  check(needs.filled_buttons.length === 1, 'screen 1 has one filled button', needs.filled_buttons);
  await press('Continue');
  await make_the_server_by_hand();

  const create = await see({ step: 'create_server', state: 'idle' }, 'screen 2');
  const key_file = path.join(app.profile, 'server_setup', 'server_key');
  check(create.copied_text === fs.readFileSync(`${key_file}.pub`, 'utf8').trim(), 'screen 2 shows the public key of the app', create.copied_text);
  check(create.copied_text.startsWith('ssh-ed25519 '), 'the key is an ed25519 key', create.copied_text);
  check((fs.statSync(key_file).mode & 0o777) === 0o600, 'only this person can read the private key');
  check(!create.copied_text.includes(fs.readFileSync(key_file, 'utf8').split('\n')[1]), 'the private key is not on the screen');
  check(create.lines_are_numbered && create.lines.length >= 3, 'screen 2 has numbered steps', create.lines);
  check(create.filled_buttons.length === 1, 'screen 2 has one filled button', create.filled_buttons);
  check(create.has_back, 'screen 2 has a way back');
  await press('Copy the SSH key');
  await see({ buttons: (buttons) => buttons.includes('Copied') }, 'the button says the key is copied');
  check((await what_the_app_says_it_shows()).text_on_the_stand_in_clipboard === create.copied_text, 'the key that was copied is the public key');
  await press('I created the server');
  await see({ step: 'server_address', state: 'idle' }, 'screen 3');
}

async function press_make_my_server() {
  await see({ step: 'where', state: 'idle' }, 'first run');
  await press('I will do it myself');
  await see({ step: 'what_you_need', state: 'idle' }, 'screen 1');
  await press('Continue');
  await see({ step: 'make_server', state: 'idle' }, 'the screen that makes the server');
  await press('Make my server');
  const waiting = await see({ step: 'make_server', state: 'working' }, 'the make screen, waiting');
  check(waiting.buttons.includes('Waiting for DigitalOcean…'), 'it says it waits for DigitalOcean', waiting.buttons);
}

const links_pressed = new Set();
async function authorize_in_the_browser() {
  const read_link = async () => {
    const links = await ask_the_app(`(() => {
      const electron = process.mainModule.require('electron');
      return process.mainModule.require(electron.app.getAppPath() + '/src/invisible_run.cjs').links_the_app_wanted_to_open;
    })()`);
    return (links ?? []).find((link) => !links_pressed.has(link)) ?? null;
  };
  let link = null;
  for (let waited = 0; !link && waited < seconds_to_wait_for_a_screen * 10; waited += 1) {
    link = await read_link();
    if (!link) await wait(100);
  }
  check(link?.includes('/v1/oauth/authorize?') && link.includes('code_challenge_method=S256'), 'the app opens the DigitalOcean page, with PKCE', link);
  links_pressed.add(link);
  await press_authorize(link);
}

async function make_the_server_by_hand(step = 'make_server') {
  const make = await see({ step, state: 'idle' }, `the screen ${step}`);
  check(make.filled_buttons.length === 1 && make.has_back, `${step} has one filled button and a way back`, make);
  await press('I will make the server myself');
}

async function connect_to_the_server(address = server_address_typed) {
  await type(address);
  await press('Continue');
  const connected = await see({ step: 'server_address', state: 'done' }, 'screen 3, connected');
  check(connected.buttons.includes('Connected'), 'screen 3 says it is connected', connected.buttons);
  const key_screen = await see({ step: 'api_key', state: 'idle' }, 'screen 4');
  check(key_screen.field_is_masked, 'the key field hides what is typed');
}

// The person typed the key once and no server has taken it. After the next connection the
// setup starts with that key: the key screen does not come again.
async function connect_and_go_straight_on(app) {
  await type(server_address_typed);
  await press('Continue');
  await see({ step: 'server_address', state: 'done' }, 'screen 3, connected');
  await finish_and_open(app);
  const sent = what_was_on_stdin_of_each_install(app);
  check(sent.length === 2 && sent[1] === key_on_stdin, 'the key typed once is sent to the new try', sent.map((text) => text.length));
}

async function walk_to_the_key_screen(app) {
  await walk_to_the_address_screen(app);
  await connect_to_the_server();
}

async function give_the_key() {
  await type(key_typed);
  await press('Set up my server');
}

// The address screen refuses once with `sentence`, then the same address works.
async function refuse_the_server_once(app, sentence) {
  await walk_to_the_address_screen(app);
  await type(server_address_typed);
  await press('Continue');
  const connecting = await see({ step: 'server_address', state: 'working' }, 'screen 3, connecting');
  check(connecting.buttons.includes('Connecting…'), 'screen 3 says it is connecting', connecting.buttons);
  const refused = await see({ step: 'server_address', state: 'failed' }, 'screen 3, refused');
  check(refused.problems.length === 1 && refused.problems[0] === sentence, 'screen 3 gives the one sentence', refused.problems);
  check(refused.field === server_address_typed, 'the address stays in the field', refused.field);
  await connect_to_the_server();
}

async function see_the_setup_run() {
  const running = await see({ step: 'setting_up', state: 'working' }, 'screen 5, working');
  check(/^It usually takes 10 to 20 minutes\. So far: \d+:\d\d\.$/.test(running.timing ?? '') || running.timing === '', 'screen 5 shows the time', running.timing);
  return running;
}

// A screen that stopped is never a dead end: it has a way back and a way to the first screen.
function check_the_ways_out(stopped, what) {
  check(stopped.buttons.includes('Back') && stopped.buttons.includes('Start over'), `${what} has "Back" and "Start over"`, stopped.buttons);
}

// The setup stopped: one sentence, one filled button, the quiet link to the log, and ways out.
async function see_the_setup_stopped(sentence, button) {
  const stopped = await see({ step: 'setting_up', state: 'failed' }, 'screen 5, stopped');
  check(stopped.problems.length === 1 && stopped.problems[0] === sentence, 'screen 5 gives the one sentence', stopped.problems);
  check(stopped.filled_buttons.length === 1 && stopped.filled_buttons[0] === button, `the one button is "${button}"`, stopped.filled_buttons);
  check(stopped.buttons.includes('Copy the log'), 'the log can be copied', stopped.buttons);
  check_the_ways_out(stopped, 'screen 5');
  return stopped;
}

// What the screen says for a reason: the words of the app where it has its own, or the sentence
// of the installer.
const said_for = (reason) => words_of_the_app_by_reason[reason] ?? sentences[reason];

async function see_the_app_open(app, page_address) {
  for (let waited = 0; waited < seconds_to_wait_for_a_screen * 10; waited += 1) {
    const pages = await list_pages();
    if (!pages.some(is_setup_page) && pages.some((page) => page.url === page_address)) return;
    await wait(100);
  }
  const pages = (await list_pages()).map((page) => page.url);
  throw new WrongScreen(`screen 6: the app did not open ${page_address} in a tab of its own\n      seen: ${JSON.stringify(pages)}`);
}

// After a setup that worked: the address is saved, and neither secret is in any file.
async function check_what_the_mac_keeps(app) {
  await wait(1500);
  const settings = JSON.parse(fs.readFileSync(path.join(app.profile, 'settings.json'), 'utf8'));
  check(settings.address === app.stand_in_address, 'the address of the server is saved', settings.address);
  const files = read_every_file_under(app.profile);
  const holds = (secret) => files.filter((file) => fs.readFileSync(file).includes(secret));
  check(holds(key_typed).length === 0, 'no file on the Mac holds the API key', holds(key_typed));
  check(holds(sign_in_token).length === 0, 'no file on the Mac holds the sign-in link', holds(sign_in_token));
}

const expected_install_command =
  `curl -fsSL ${installer_address}/install.sh -o /root/install.sh && ` +
  'INSTALL_DIR=/opt/alfera bash /root/install.sh --unattended --progress --answers-stdin --install-docker --https=203-0-113-7.sslip.io';

// What the app handed to ssh: the fixed commands, its own key and list of servers, no question
// asked, and the API key on stdin only.
function check_the_calls(app) {
  const calls = app.read_calls();
  const [check_call, install_call, link_call] = ['check', 'install', 'sign_in_link'].map((kind) => calls.find((call) => call.kind === kind));
  const folder = path.join(app.profile, 'server_setup');
  for (const call of calls) {
    const words = call.called_with.join(' ');
    check(!words.includes(key_typed), `the API key is in no argument of the ${call.kind} call`);
    check(call.called_with.at(-2) === `root@${server_address_typed}`, 'ssh connects as root to the address typed', call.called_with.at(-2));
    for (const option of ['BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=accept-new', 'ConnectTimeout=15', `UserKnownHostsFile="${path.join(folder, 'known_hosts')}"`]) {
      check(call.called_with.includes(option), `ssh gets ${option}`, call.called_with);
    }
    check(call.called_with[call.called_with.indexOf('-i') + 1] === path.join(folder, 'server_key'), 'ssh signs in with the key of the app');
  }
  check(check_call.called_with.at(-1).includes('alfera-server-check'), 'the first call looks at the server');
  check(install_call.called_with.at(-1) === expected_install_command, 'the install command is the one of the contract', install_call.called_with.at(-1));
  check(install_call.stdin === key_on_stdin, 'the API key goes in on stdin, as the one line MODEL_KEY=<key>', install_call.stdin.length);
  check(link_call.called_with.at(-1) === `cd '${install_dir}' && ./alfera team link 10 --progress`, 'the link command is the one of the contract, with the folder in quotes', link_call.called_with.at(-1));
}

// The log a person copies: it has the words of the server, and neither secret. In this run the
// copy goes to the stand-in clipboard of the app, and is read back from there. The clipboard of
// the Mac is not read and not written.
async function check_the_log(...must_hold) {
  await press('Copy the log');
  await see({ buttons: (buttons) => buttons.includes('The log is copied') }, 'the link says the log is copied');
  const log = (await what_the_app_says_it_shows()).text_on_the_stand_in_clipboard;
  check(typeof log === 'string' && log.length > 0, 'the log was copied');
  for (const words of must_hold) check(log.includes(words), `the log holds "${words}"`, log.slice(0, 300));
  check(!/[\x00-\x08\x0b-\x1f\x7f]/.test(log), 'the log is plain text: no code for a terminal, no control character');
  check(!log.includes(key_typed), 'the log does not hold the API key');
  check(!log.includes(sign_in_token), 'the log does not hold the sign-in link');
}

async function finish_and_open(app) {
  await see_the_setup_run();
  await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
}

const what_was_on_stdin_of_each_install = (app) =>
  app.read_calls().filter((call) => call.kind === 'install').map((call) => call.stdin);

const rank_of_a_row = { waiting: 0, working: 1, failed: 1, done: 2 };
const seconds_shown = (timing) => {
  const [, minutes, seconds] = /So far: (\d+):(\d\d)\./.exec(timing ?? '') ?? [null, 0, 0];
  return Number(minutes) * 60 + Number(seconds);
};

// After a lost connection the server shows the same install again, from its first line. The
// screen must go on from `before`: no row steps back, and the time does not start again. This
// looks at the screen ten times a second until the app opens.
async function see_the_setup_go_on_from(app, before) {
  let last = before;
  for (let waited = 0; waited < seconds_to_wait_for_a_screen * 10; waited += 1) {
    const pages = await list_pages();
    if (!pages.some(is_setup_page)) break;
    const now = await read_screen();
    if (now?.step === 'api_key') throw new WrongScreen('the key was asked for again');
    if (now?.step === 'setting_up' && now.rows.length === last.rows.length && now.timing) {
      const stepped_back = now.rows.findIndex((row, index) => rank_of_a_row[row] < rank_of_a_row[last.rows[index]]);
      check(stepped_back === -1, `no row steps back (row ${stepped_back + 1})`, { before: last.rows, now: now.rows });
      check(seconds_shown(now.timing) >= seconds_shown(last.timing), 'the time does not start again', { before: last.timing, now: now.timing });
      last = now;
    }
    await wait(100);
  }
  await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
}

// A cut connection, then "Try again": the same command, and the same install on the screen.
async function lose_the_connection_and_try_again(app, row_under_way) {
  await walk_to_the_key_screen(app);
  await give_the_key();
  const lost = await see_the_setup_stopped('The connection to your server was lost. Check your internet connection, then try again.', 'Try again');
  check(lost.rows[row_under_way] === 'working', 'the step under way when the connection dropped is not marked as failed', lost.rows);
  check(lost.rows.slice(0, row_under_way).every((row) => row === 'done'), 'the steps before it are done', lost.rows);
  await check_the_log('closed by remote host');
  await press('Try again');
  await see_the_setup_go_on_from(app, lost);
  const installs = app.read_calls().filter((call) => call.kind === 'install');
  check(installs.length === 2 && installs[0].called_with.at(-1) === installs[1].called_with.at(-1), 'the second try runs the same command');
}

// ---- the runs --------------------------------------------------------------------------------

const refusals_of_the_address_screen = {
  nothing_answers: `Nothing answers at ${server_address_typed}. Check the address, wait a minute for the server to start, then try again.`,
  key_refused: 'The server refused the SSH key of this app. The SSH key was most likely not pasted when the server was made. Go back, make a new server with the SSH key, then try again.',
  identity_changed: `Another server than before now answers at ${server_address_typed}, so the app did not connect. Make a new server to get a new address, then enter that address.`,
  not_ubuntu: 'This server runs debian 12, not Ubuntu 24.04. Go back, make a new server with Ubuntu 24.04, then try again.',
  not_root: 'This server does not let the setup sign in as root. Go back, make a new server the way the steps say, then try again.',
};

async function run_in_deploy_page(expression) {
  const page = (await list_pages()).find(is_deploy_page);
  check(page, 'the deploy page is open in the window');
  return ask_page(page, 'Runtime.evaluate', { expression, returnByValue: true });
}

async function see_the_deploy_page() {
  for (let waited = 0; waited < seconds_to_wait_for_a_screen * 10; waited += 1) {
    const ready = await run_in_deploy_page(`document.readyState === 'complete' && Boolean(document.querySelector('#open'))`).catch(() => null);
    if (ready?.result?.value) return;
    await wait(100);
  }
  throw new WrongScreen('the deploy page did not open in the window');
}

async function read_links_opened_outside() {
  return (await ask_the_app(`(() => {
    const electron = process.mainModule.require('electron');
    return process.mainModule.require(electron.app.getAppPath() + '/src/invisible_run.cjs').links_the_app_wanted_to_open;
  })()`)) ?? [];
}

const press_escape_in_the_deploy_page = () =>
  ask_the_app(`(() => {
    const electron = process.mainModule.require('electron');
    const page = electron.webContents.getAllWebContents().find((contents) => URL.parse(contents.getURL())?.pathname === '/deploy');
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    return true;
  })()`);

const runs = {
  the_deploy_page_opens_the_new_server: async (app) => {
    const first = await see({ step: 'where', state: 'idle' }, 'first run');
    check(first.buttons.includes('I will do it myself'), 'the guided setup by hand is a quiet link under the row', first.buttons);
    await press('Set it up');
    await see_the_deploy_page();
    await see_that_nothing_shows(app, 'on the deploy page');
    await run_in_deploy_page(`document.querySelector('#aws').click()`);
    await wait(500);
    const outside = await read_links_opened_outside();
    check(outside.includes(aws_console_link), 'the AWS console opens in the browser', outside);
    check((await list_pages()).some(is_deploy_page), 'the deploy page stays in the window');
    await press_escape_in_the_deploy_page();
    await see({ step: 'where', state: 'idle' }, 'Escape leaves the deploy page for the first screen');
    check(!(await list_pages()).some(is_deploy_page), 'the deploy page is closed');
    await press('Set it up');
    await see_the_deploy_page();
    await run_in_deploy_page(`document.querySelector('#open').click()`);
    await see_the_app_open(app, `${app.stand_in_address}/setup#token=${setup_token}`);
    check(!(await list_pages()).some(is_deploy_page), 'the deploy page is closed when the server opens');
    await wait(1500);
    check(read_saved_address(app) === app.stand_in_address, 'the new server is the address of the app', read_saved_address(app));
    const files_with_the_token = read_every_file_under(app.profile).filter((file) => fs.readFileSync(file).includes(setup_token));
    check(files_with_the_token.length === 0, 'no file on the Mac holds the setup token', files_with_the_token);
  },
  the_deploy_page_does_not_open: async () => {
    await see({ step: 'where', state: 'idle' }, 'first run');
    await press('Set it up');
    const stopped = await see({ step: 'where', state: 'failed' }, 'the deploy page does not open');
    check(stopped.problems.length === 1 && stopped.problems[0] === 'The setup page does not open. Check that this Mac is online, then try again.', 'the row says why in one sentence', stopped.problems);
    check(stopped.buttons.includes('Set it up'), 'the person can try again', stopped.buttons);
    check(!(await list_pages()).some(is_deploy_page), 'no deploy page is left over');
  },
  everything_works: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const running = await see_the_setup_run();
    check(running.rows.length === 8, 'screen 5 lists the steps of the installer', running.rows);
    const some_done = (rows) => rows.includes('done') && rows.includes('working') && rows.includes('waiting');
    const later = await see({ step: 'setting_up', state: 'working', rows: some_done }, 'screen 5, with steps done, one working and others waiting');
    const time_shown = new RegExp(`^It usually takes ${usual_time_for_the_install}\\. So far: 0:0[1-9]\\.$`);
    check(time_shown.test(later.timing), 'screen 5 shows the usual time and the time so far', later.timing);
    await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
    await check_what_the_mac_keeps(app);
    check_the_calls(app);
  },
  an_address_that_is_not_one: async (app) => {
    await walk_to_the_address_screen(app);
    for (const text of ['', 'root@203.0.113.7', '203.0.113.7; touch /tmp/x', '-oProxyCommand=x', 'https://203.0.113.7', '203.0.113.999']) {
      await type(text);
      await press('Continue');
      // The screen still shows the refusal of the text before. The press lands a moment later.
      await wait(200);
      const refused = await see({ step: 'server_address', state: 'failed' }, `screen 3 with "${text}"`);
      check(refused.problems[0] === 'That is not a server address. Enter only the address, such as 203.0.113.7.', 'screen 3 says it is not an address', refused.problems);
    }
    check(app.read_calls().length === 0, 'ssh was never started for a text that is not an address', app.read_calls());
  },
  ...Object.fromEntries(Object.entries(refusals_of_the_address_screen).map(([name, sentence]) => [name, (app) => refuse_the_server_once(app, sentence)])),
  a_key_that_is_not_one: async (app) => {
    await walk_to_the_key_screen(app);
    await press('Set up my server');
    check((await see({ step: 'api_key', state: 'failed' }, 'screen 4, no key')).problems[0] === 'Paste your API key first.', 'screen 4 asks for the key');
    await type('two words');
    await press('Set up my server');
    const says_it_has_a_space = (problems) => problems[0] === 'An API key is one line with no spaces. Paste it again.';
    await see({ step: 'api_key', state: 'failed', problems: says_it_has_a_space }, 'screen 4, a key with a space');
    check(!app.read_calls().some((call) => call.kind === 'install'), 'the installer was not started');
  },
  model_key_refused: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_run();
    const back = await see({ step: 'api_key', state: 'failed' }, 'screen 4 again, after the API key was refused');
    check(back.problems.length === 1 && back.problems[0] === 'Anthropic or OpenAI refused that API key. Check your API key, then paste it again.', 'screen 4 says it in the words of the app', back.problems);
    check(back.field === '', 'the refused key is gone from the field', back.field);
    await give_the_key();
    await finish_and_open(app);
  },
  stops_and_works_on_a_second_try: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_run();
    const stopped = await see_the_setup_stopped(sentences.api_did_not_answer, 'Try again');
    check(stopped.rows[6] === 'failed' && stopped.rows[5] === 'done', 'the step that stopped is marked', stopped.rows);
    await check_the_log('api_did_not_answer', 'for the check, the answers on stdin were', 'for the check, a link', 'words a terminal would colour: red words and the end');
    await press('Try again');
    await finish_and_open(app);
    const installs = app.read_calls().filter((call) => call.kind === 'install');
    check(installs.length === 2 && installs[0].called_with.at(-1) === installs[1].called_with.at(-1), 'the second try runs the same command');
    check(installs[1].stdin === '', 'the server had the key, so the second try sends none', installs[1].stdin.length);
  },
  stops_before_the_server_has_the_key: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped(sentences.source_download_failed, 'Try again');
    await press('Try again');
    await finish_and_open(app);
    const sent = what_was_on_stdin_of_each_install(app);
    check(sent.length === 2 && sent[1] === key_on_stdin, 'the server had no key yet, so the second try sends it again', sent.map((text) => text.length));
  },
  connection_lost_while_docker_installs: async (app) => {
    await lose_the_connection_and_try_again(app, 1);
    const sent = what_was_on_stdin_of_each_install(app);
    check(sent[1] === key_on_stdin, 'the server had no key yet, so the second try sends it again', sent.map((text) => text.length));
  },
  connection_lost_after_the_server_has_the_key: async (app) => {
    await lose_the_connection_and_try_again(app, 4);
    const sent = what_was_on_stdin_of_each_install(app);
    check(sent[1] === '', 'the server had the key, so the second try sends none', sent.map((text) => text.length));
  },
  another_setup_is_running: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped(sentences.install_running, 'Try again');
    await press('Try again');
    await finish_and_open(app);
    check(what_was_on_stdin_of_each_install(app)[1] === key_on_stdin, 'the second try sends the key again');
  },
  setup_was_interrupted: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped(sentences.install_interrupted, 'Try again');
    await press('Try again');
    await finish_and_open(app);
    check(what_was_on_stdin_of_each_install(app)[1] === '', 'the server had the key, so the second try sends none');
  },
  needs_a_bigger_server: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped('This server has too little memory to build Alfera. Make a bigger server.', 'Make a bigger server');
    await press('Make a bigger server');
    const make_bigger = await see({ step: 'make_bigger_server', state: 'idle' }, 'the screen that makes a bigger server');
    check(make_bigger.lead === 'The first server had too little memory. The app makes one with 8 GB of memory, which costs 48 dollars a month.', 'it says the bigger size in one sentence', make_bigger.lead);
    await make_the_server_by_hand('make_bigger_server');
    const bigger = await see({ step: 'create_bigger_server', state: 'idle' }, 'screen 2 again, for a bigger server');
    check(bigger.lead === 'The first server had too little memory. Make one with 8 GB of memory, which costs 48 dollars a month.', 'screen 2 says in one sentence which size to make', bigger.lead);
    check(bigger.lines.some((step) => step.includes('8 GB of memory')) && !bigger.lines.some((step) => step.includes('4 GB')), 'the steps name the bigger size', bigger.lines);
    check(bigger.copied_text.startsWith('ssh-ed25519 '), 'the key of the app is there to copy again', bigger.copied_text);
    await press('I created the server');
    await see({ step: 'server_address', state: 'idle' }, 'screen 3 again');
    // The bigger server is another server, with another address: it gets the key screen.
    await connect_to_the_server('203.0.113.8');
  },
  needs_a_new_server: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped(sentences.docker_install_failed, 'Make a new server');
    await press('Make a new server');
    await make_the_server_by_hand();
    await see({ step: 'create_server', state: 'idle' }, 'screen 2 again');
    await press('I created the server');
    await see({ step: 'server_address', state: 'idle' }, 'screen 3 again');
    await connect_and_go_straight_on(app);
  },
  needs_another_address: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped('The server could not work out its public address. Enter a domain name that points at the server.', 'Change the address');
    await press('Change the address');
    const address_screen = await see({ step: 'server_address', state: 'idle' }, 'screen 3 again');
    check(address_screen.lead.endsWith('A domain name that points at the server works too.'), 'the address screen says a domain name works too', address_screen.lead);
    await connect_and_go_straight_on(app);
  },
  reason_from_a_newer_installer: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const stopped = await see_the_setup_stopped(sentences.from_a_newer_installer, 'Try again');
    check(!stopped.problem_holds_a_tag, 'a tag in the sentence of the server is shown as text, not drawn');
    await press('Try again');
    await finish_and_open(app);
  },
  ...Object.fromEntries(['server_names_another_address', 'server_names_a_folder_that_is_a_command'].map((name) => [name, async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped('The setup stopped. Try again. If it stops again, copy the log: it says where the setup stopped.', 'Try again');
    check(!app.read_calls().some((call) => call.kind === 'sign_in_link'), 'no command was sent with what the server named');
    check(read_saved_address(app) === undefined, 'nothing was saved');
    check(!(await list_pages()).some((page) => page.url.startsWith('https://')), 'nothing was opened');
    await press('Try again');
    await finish_and_open(app);
  }])),
  link_to_another_address: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const stopped = await see({ step: 'signing_in', state: 'failed' }, 'screen 6, a link that leads elsewhere');
    check_the_ways_out(stopped, 'screen 6');
    check(stopped.problems.length === 1 && stopped.problems[0] === 'Your server is set up, but its sign-in link could not be used. Try again.', 'screen 6 gives one sentence', stopped.problems);
    check(read_saved_address(app) === undefined, 'nothing was saved');
    check(!(await list_pages()).some((page) => page.url.startsWith('https://')), 'nothing was opened');
    await press('Try again');
    await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
  },
  server_with_a_shared_name: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const done = await see({ step: 'signing_in_on_a_shared_name', state: 'working' }, 'screen 6, with the line about the address');
    check(done.note === 'This address is fine for trying Alfera out. For real use, point a domain name of your own at the server.', 'screen 6 shows the one quiet line', done.note);
    check(done.buttons.length === 0, 'screen 6 has no button', done.buttons);
    await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
  },
  server_with_a_name_of_its_own: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const done = await see({ step: 'signing_in' }, 'screen 6');
    check(done.note === null, 'screen 6 shows no line about the address', done.note);
    await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
  },
  no_certificate_for_the_sign_in: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const back = await see({ step: 'server_address', state: 'failed' }, 'screen 3 again, after no certificate');
    check(back.problems.length === 1 && back.problems[0] === sentences.certificate_not_issued, 'screen 3 gives the sentence of the server', back.problems);
    await type(server_address_typed);
    await press('Continue');
    await see({ step: 'server_address', state: 'done' }, 'screen 3, connected');
    await finish_and_open(app);
    const sent = what_was_on_stdin_of_each_install(app);
    check(sent.length === 2 && sent[1] === '', 'the server has the key, so it is not asked for and not sent again', sent.map((text) => text.length));
  },
  setup_does_not_start: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped('The setup could not start on your server. Check that the server can reach the internet, then try again.', 'Try again');
    await press('Try again');
    await finish_and_open(app);
  },
  no_sign_in_link: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const stopped = await see({ step: 'signing_in', state: 'failed' }, 'screen 6, no link');
    check(stopped.problems.length === 1 && stopped.problems[0] === sentences.sign_in_link_not_made, 'screen 6 gives the sentence of the server', stopped.problems);
    check(stopped.filled_buttons.length === 1 && stopped.filled_buttons[0] === 'Try again', 'the one button is "Try again"', stopped.filled_buttons);
    check_the_ways_out(stopped, 'screen 6');
    await press('Try again');
    await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
  },
  server_with_its_own_sign_in: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    const stopped = await see({ step: 'signing_in', state: 'failed' }, 'screen 6, a server with its own sign-in');
    check(stopped.problems[0] === 'Your server has a sign-in page of its own, so it needs no sign-in link.', 'screen 6 says it in the words of the app', stopped.problems);
    check_the_ways_out(stopped, 'screen 6');
    await press('Open Alfera');
    await see_the_app_open(app, `${app.stand_in_address}/`);
  },
  // The place the installer comes from does not answer: the first screen does not offer the
  // guided setup by hand, and still offers the deploy page and the other two choices.
  installer_does_not_answer: async () => {
    const first = await see({ step: 'where', state: 'idle' }, 'first run');
    check(!first.buttons.includes('I will do it myself'), 'the guided setup by hand has no link', first.buttons);
    check(first.buttons.includes('Set it up'), 'the deploy page needs no installer, so its button is there', first.buttons);
    check(first.buttons.includes('Use Alfera Cloud') && first.buttons.includes('I already have an Alfera server'), 'the other two choices are there', first.buttons);
  },
  // The tallest step in a small window: it opens at its top, with "Back" in sight. In a window
  // where a step fits, nothing scrolls.
  a_small_window: async (app) => {
    // A window that is never on the screen takes a new size with its next frame, and draws no
    // frame by itself. Asking the page for a small picture makes it draw one.
    const set_the_window = (width, height) => ask_the_app(`(async () => {
      const electron = process.mainModule.require('electron');
      electron.BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('shell.html')).setContentSize(${width}, ${height});
      const page = electron.webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('setup.html'));
      page.debugger.attach('1.3');
      await page.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 1 });
      page.debugger.detach();
      return true;
    })()`);
    await see({ step: 'where', state: 'idle' }, 'first run');
    for (const [width, height] of [[1024, 700], [1280, 800], [1512, 982]]) {
      await set_the_window(width, height);
      await see({ height_of_the_window: height - 44 }, `the window is ${width} by ${height}`);
      await press('I will do it myself');
      await see({ step: 'what_you_need', state: 'idle' }, 'screen 1');
      await press('Continue');
      await make_the_server_by_hand();
      const create = await see({ step: 'create_server', state: 'idle', copied_text: (text) => Boolean(text) }, 'screen 2');
      check(create.scrolled_by === 0 && create.top_of_the_first_thing >= 0, `at ${width} by ${height} the step opens at its top, with "Back" in sight`, create);
      const fits = create.height_of_the_step <= create.height_of_the_window;
      check(!fits || create.room_to_scroll === 0, `at ${width} by ${height} a step that fits does not scroll`, create);
      check(fits || Math.abs(create.room_to_scroll - (create.height_of_the_step - create.height_of_the_window)) <= 1, `at ${width} by ${height} a step that does not fit scrolls over itself only, not over empty space`, create);
      await press_escape();
      await see({ step: 'make_server', state: 'idle' }, 'Escape goes one step back');
      await press_escape();
      await see({ step: 'what_you_need', state: 'idle' }, 'Escape goes one more step back');
      await press_escape();
      await see({ step: 'where', state: 'idle' }, 'Escape goes back to the first screen');
    }
  },
  // A setup that stops every time is never a dead end: Escape, "Start over", "Back" and
  // "Change Address…" each lead out of it.
  ways_out_of_a_setup_that_stopped: async (app) => {
    const stop_the_setup = async () => {
      await type(server_address_typed);
      await press('Continue');
      return see_the_setup_stopped('The setup could not start on your server. Check that the server can reach the internet, then try again.', 'Try again');
    };
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_stopped('The setup could not start on your server. Check that the server can reach the internet, then try again.', 'Try again');
    await press_escape();
    await see({ step: 'server_address', state: 'idle' }, 'Escape goes back to the address');
    await stop_the_setup();
    await press('Back');
    await see({ step: 'server_address', state: 'idle' }, '"Back" goes back to the address');
    await stop_the_setup();
    await press('Start over');
    const first = await see({ step: 'where', state: 'idle' }, '"Start over" goes to the first screen');
    check(first.buttons.includes('Use Alfera Cloud'), 'the first screen offers Alfera Cloud', first.buttons);
    await press('I will do it myself');
    await see({ step: 'what_you_need', state: 'idle' }, 'the setup starts again');
    await press('Continue');
    await make_the_server_by_hand();
    await see({ step: 'create_server', state: 'idle' }, 'screen 2 again');
    await press('I created the server');
    await see({ step: 'server_address', state: 'idle' }, 'screen 3 again');
    await stop_the_setup();
    await choose_change_address();
    await see({ step: 'where', state: 'idle' }, '"Change Address…" goes to the first screen');
    check(read_saved_address(app) === undefined, 'no address was saved by a setup that never worked');
  },
  digitalocean_makes_the_server: async (app) => {
    await press_make_my_server();
    await authorize_in_the_browser();
    const key_screen = await see({ step: 'api_key', state: 'idle' }, 'the key screen, after the server was made');
    check(key_screen.field_is_masked, 'the key field hides what is typed');
    await give_the_key();
    await finish_and_open(app);
    await check_what_the_mac_keeps(app);
    check_the_calls(app);
    const { state } = app.digitalocean;
    const public_key = fs.readFileSync(path.join(app.profile, 'server_setup', 'server_key.pub'), 'utf8').trim();
    check(state.keys.length === 1 && state.keys[0].public_key === public_key, 'the key of the app went to the account', state.keys);
    check(state.droplets.length === 1 && state.droplets[0].ssh_keys[0] === state.keys[0].fingerprint, 'one server was made, with that key', state.droplets);
    check([...state.tokens.values()].every((token) => token.given_back), 'the access to the account was given back');
    const files = read_every_file_under(app.profile);
    const holds_a_token = [...state.tokens.keys()].some((token) => files.some((file) => fs.readFileSync(file).includes(token)));
    check(!holds_a_token, 'no file on the Mac holds the DigitalOcean token');
    check(app.read_calls().filter((call) => call.kind === 'check').length === 2, 'the app tried again while the new server refused its key');
  },
  digitalocean_sign_in_refused: async (app) => {
    await press_make_my_server();
    await authorize_in_the_browser();
    const refused = await see({ step: 'make_server', state: 'failed' }, 'the make screen, refused');
    check(refused.problems.length === 1 && refused.problems[0] === words_by_reason.not_authorized, 'it gives the one sentence', refused.problems);
    check(refused.filled_buttons[0] === 'Make my server', 'the button can be pressed again', refused.filled_buttons);
    check(app.digitalocean.state.droplets.length === 0, 'no server was made');
    await press('I will make the server myself');
    await see({ step: 'create_server', state: 'idle' }, 'the way by hand is still there');
  },
  digitalocean_stop_while_waiting: async (app) => {
    await press_make_my_server();
    await press('Stop');
    const stopped = await see({ step: 'make_server', state: 'failed' }, 'the make screen, stopped');
    check(stopped.problems[0] === words_by_reason.stopped, 'it says the app stopped', stopped.problems);
    check(stopped.filled_buttons[0] === 'Make my server' && !stopped.buttons.includes('Stop'), 'the button is back, and "Stop" is gone', stopped.buttons);
    check(app.digitalocean.state.droplets.length === 0, 'no server was made');
  },
  digitalocean_new_server_after_a_failed_install: async (app) => {
    await press_make_my_server();
    await authorize_in_the_browser();
    await see({ step: 'api_key', state: 'idle' }, 'the key screen');
    await give_the_key();
    await see_the_setup_stopped(sentences.docker_install_failed, 'Make a new server');
    await press('Make a new server');
    await see({ step: 'make_server', state: 'idle' }, 'the make screen again');
    await press('Make my server');
    await authorize_in_the_browser();
    await see({ step: 'setting_up' }, 'the setup goes on with the key typed once');
    const { droplets } = app.digitalocean.state;
    check(droplets.length === 2, 'a second server was made', droplets.length);
    const checks = app.read_calls().filter((call) => call.kind === 'check');
    check(checks.at(-1).called_with.at(-2) === 'root@203.0.113.8', 'the app connects to the second server', checks.at(-1).called_with);
  },
  digitalocean_makes_no_server: async (app) => {
    await press_make_my_server();
    await authorize_in_the_browser();
    const refused = await see({ step: 'make_server', state: 'failed' }, 'the make screen, no server');
    const words = 'DigitalOcean did not make the server. It says: "You must add a payment method before you can create a Droplet."';
    check(refused.problems.length === 1 && refused.problems[0] === words, 'it gives the words of DigitalOcean', refused.problems);
    check([...app.digitalocean.state.tokens.values()].every((token) => token.given_back), 'the access to the account was given back');
  },
  // "Change Address…" while the server works: the first screen shows, and what the server says
  // later does not land on it.
  change_address_while_the_setup_works: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await see_the_setup_run();
    await choose_change_address();
    await see({ step: 'where', state: 'idle' }, '"Change Address…" goes to the first screen while the setup works');
    await wait(2500);
    const later = await read_screen();
    check(later.step === 'where' && later.state === 'idle' && later.problems.length === 0, 'the first screen stays as it is', later);
  },
  // The person who set the server up is signed out later. The app has the SSH key for that
  // server, so it gets a new sign-in link from it: one button.
  new_sign_in_link_from_my_server: async (app) => {
    await walk_to_the_key_screen(app);
    await give_the_key();
    await finish_and_open(app);
    await send_the_tab_to(`${app.stand_in_address}/home`);
    const asks = await see({ step: 'sign_in_link', state: 'idle' }, 'signed out: the app asks for a sign-in link');
    check(asks.buttons.includes('Get a new sign-in link from my server'), 'the app set this server up, so it offers a link from it', asks.buttons);
    check(asks.has_back && asks.lead.includes('./alfera team link'), 'the screen says where a link comes from and has a way back', asks.lead);
    await press('Get a new sign-in link from my server');
    const waiting = await see({ step: 'sign_in_link', state: 'working' }, 'the screen says it is asking the server');
    check(waiting.buttons.includes('Asking your server…'), 'the button says what it does', waiting.buttons);
    const stopped = await see({ step: 'sign_in_link', state: 'failed' }, 'the server made no link');
    check(stopped.problems.length === 1 && stopped.problems[0] === sentences.sign_in_link_not_made, 'the screen gives the one sentence', stopped.problems);
    check(stopped.filled_buttons.includes('Try again') && stopped.buttons.includes('Copy the log') && stopped.has_back, 'one button to try again, the log, and a way back', stopped.buttons);
    await press('Try again');
    await see_the_app_open(app, `${app.stand_in_address}/join/${sign_in_token}`);
    const link_calls = app.read_calls().filter((call) => call.kind === 'sign_in_link');
    check(link_calls.length === 3 && link_calls.every((call) => call.called_with.at(-1) === `cd '${install_dir}' && ./alfera team link 10 --progress`), 'each link came from the command of the contract', link_calls.map((call) => call.called_with.at(-1)));
    check(link_calls.every((call) => call.called_with[call.called_with.indexOf('-i') + 1] === path.join(app.profile, 'server_setup', 'server_key')), 'the app signed in to the server with its own SSH key');
    await check_what_the_mac_keeps(app);
  },
};

const digitalocean_of_a_run = {
  digitalocean_sign_in_refused: { refuse_sign_in: true },
  digitalocean_makes_no_server: { refuse_server_with: 'You must add a payment method before you can create a Droplet.' },
};

// What a run changes in the environment of the app.
const environment_of_a_run = {
  installer_does_not_answer: { ALFERA_INSTALLER_ADDRESS: `${address_of_the_server}/no-installer-here` },
  the_deploy_page_does_not_open: { ALFERA_DEPLOY_PAGE_ADDRESS: 'http://127.0.0.1:9/deploy' },
};

async function main() {
  const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(runs);
  const { server, port } = await start_stand_in_server();
  const deploy_page = await start_stand_in_deploy_page(address_of_the_server);
  const failed = [];
  for (const name of wanted) {
    const digitalocean = await start_stand_in_digitalocean(digitalocean_of_a_run[name]);
    const app = await start_app(name, port, { ALFERA_DEPLOY_PAGE_ADDRESS: deploy_page.address, ...digitalocean.environment, ...environment_of_a_run[name] });
    app.digitalocean = digitalocean;
    try {
      await runs[name](app);
      await see_that_nothing_shows(app, 'at the end of the run');
      console.log(`ok    ${name}`);
    } catch (error) {
      if (error instanceof SomethingShowed) {
        console.log(`STOPPED  ${name}\n      ${error.message}`);
        process.exit(2);
      }
      if (!(error instanceof WrongScreen)) throw error;
      failed.push(name);
      console.log(`FAIL  ${name}\n      ${error.message}`);
    } finally {
      await app.stop();
      await digitalocean.close();
    }
  }
  server.close();
  deploy_page.server.close();
  console.log(failed.length === 0 ? `every run passed: ${wanted.length}` : `runs that failed: ${failed.join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
