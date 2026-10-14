const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Alfera waits 110 seconds for one tool call, so a command must end before that.
const maximum_command_seconds = 100;
const maximum_output_characters = 60_000;

// The macOS sandbox lets the command read anything it could read before, but write only inside
// the folder, the temp folders and the usual tool caches. A wrong `rm -rf ~` fails.
// Reads stay open, so a command can still read a file outside the folder. Add
// (deny file-read* …) rules for private folders if that becomes a real concern.
function macos_write_fence(folder) {
  const home = os.homedir();
  const writable = [
    folder,
    '/private/tmp',
    '/private/var/folders',
    '/dev',
    path.join(home, 'Library/Caches'),
    path.join(home, '.npm'),
    path.join(home, '.cache'),
  ];
  const allowed = writable.map((place) => `(subpath ${JSON.stringify(place)})`).join(' ');
  return `(version 1)(allow default)(deny file-write*)(allow file-write* ${allowed})`;
}

function command_line(folder, command) {
  if (process.platform !== 'darwin') return { file: '/bin/sh', args: ['-c', command] };
  return {
    file: '/usr/bin/sandbox-exec',
    args: ['-p', macos_write_fence(folder), '/bin/sh', '-c', command],
  };
}

// The command gets a plain environment. Nothing the app itself holds is passed to it.
function command_environment() {
  const kept = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR'];
  return Object.fromEntries(
    kept.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  );
}

function shorten(text) {
  if (text.length <= maximum_output_characters) return text;
  return `${text.slice(0, maximum_output_characters)}\n(output cut at ${maximum_output_characters} characters)`;
}

function run_command(folder, { command, timeout_seconds = 60 }) {
  const root = fs.realpathSync(folder);
  const seconds = Math.min(Math.max(timeout_seconds, 1), maximum_command_seconds);
  const { file, args } = command_line(root, command);
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: root,
      env: command_environment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timed_out = false;
    const timer = setTimeout(() => {
      timed_out = true;
      child.kill('SIGKILL');
    }, seconds * 1000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => (stderr += error.message));
    child.on('close', (exit_code) => {
      clearTimeout(timer);
      const ending = timed_out ? `stopped after ${seconds} seconds` : `exit code ${exit_code}`;
      resolve({
        text: [ending, shorten(stdout), shorten(stderr)].filter(Boolean).join('\n'),
        failed: timed_out || exit_code !== 0,
      });
    });
  });
}

module.exports = { run_command, maximum_command_seconds };
