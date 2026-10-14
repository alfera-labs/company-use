// Every run of the app that a script starts is invisible (src/invisible_run.cjs). The app hides
// itself as soon as its own code runs, but macOS decides whether an app gets a Dock icon before
// that. So a script starts the app from a copy of Electron that is marked as an app with no Dock
// icon from its first moment. The copy is made once, beside the installed Electron, and takes
// almost no room on a Mac disk: the files are shared until one of them changes.
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const app_folder = path.resolve(__dirname, '..');
const exit_code_for_a_run_started_wrong = 64;

function prepare_invisible_electron() {
  const installed_app = path.resolve(require('electron'), '../../..');
  const version = require('electron/package.json').version;
  const copy_folder = path.join(app_folder, 'node_modules', '.cache', 'alfera-invisible-electron', version);
  const copy = path.join(copy_folder, 'Electron.app');
  const is_ready = path.join(copy_folder, 'ready');
  if (!fs.existsSync(is_ready)) {
    fs.rmSync(copy_folder, { recursive: true, force: true });
    fs.mkdirSync(copy_folder, { recursive: true });
    execFileSync('cp', ['-Rc', installed_app, copy]);
    const mark_as_no_dock_icon = ['-c', 'Add :LSUIElement bool true', path.join(copy, 'Contents', 'Info.plist')];
    execFileSync('/usr/libexec/PlistBuddy', mark_as_no_dock_icon);
    // The mark changed a file the signature covers, so the copy is signed again, by nobody.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', copy], { stdio: 'ignore' });
    fs.writeFileSync(is_ready, '');
  }
  return path.join(copy, 'Contents', 'MacOS', 'Electron');
}

// Starts the app with nothing on the screen. `switches` go to the app; `environment` is added to
// the environment of this process.
function start_invisible_app({ switches = [], environment = {}, stdio = 'ignore' }) {
  return spawn(prepare_invisible_electron(), [app_folder, ...switches], {
    stdio,
    env: { ...process.env, ...environment, ALFERA_INVISIBLE: '1' },
  });
}

// A script that starts the app calls this first. Without the switch it stops: a run that could
// put a window on the screen must not start by mistake.
function stop_unless_the_run_is_invisible(name_of_the_script) {
  if (process.env.ALFERA_INVISIBLE === '1') return;
  process.stderr.write(`${name_of_the_script} starts the app, and it must not show on the screen. Set ALFERA_INVISIBLE=1, or use the npm script.\n`);
  process.exit(exit_code_for_a_run_started_wrong);
}

module.exports = { prepare_invisible_electron, start_invisible_app, stop_unless_the_run_is_invisible };
