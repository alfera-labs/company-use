import { spawn } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

function the_system_finds_a_file_by_identity() {
  try {
    const folder = realpathSync(tmpdir());
    const identity = statSync(folder, { bigint: true });
    return realpathSync(`/.vol/${identity.dev}/${identity.ino}`) === folder;
  } catch {
    return false;
  }
}

/**
 * True where the system can say where an open file is (Linux, and macOS under Bun), so a swap
 * can never win. Elsewhere the check is by name and a swap can still win.
 */
export const an_open_file_knows_its_path =
  existsSync('/proc/self/fd') || the_system_finds_a_file_by_identity();

const swap_script = `
const fs = require('node:fs');
const { folder, parked, link_target, run_ms } = process.env;
const stop_at = Date.now() + Number(run_ms);
let swaps = 0;
while (Date.now() < stop_at) {
  fs.renameSync(folder, parked);
  fs.symlinkSync(link_target, folder);
  fs.unlinkSync(folder);
  fs.renameSync(parked, folder);
  swaps += 1;
}
process.stdout.write(String(swaps));
`;

/**
 * Runs another process that, for `run_ms`, keeps replacing `folder` with a link to `link_target`
 * and putting the real folder back. Resolves with how many times it swapped.
 */
export function swap_folder_with_link(input: {
  folder: string;
  link_target: string;
  run_ms: number;
}) {
  const child = spawn(process.execPath, ['-e', swap_script], {
    env: {
      folder: input.folder,
      parked: `${input.folder}.parked`,
      link_target: input.link_target,
      run_ms: String(input.run_ms),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let printed = '';
  child.stdout.on('data', (chunk) => {
    printed += String(chunk);
  });
  let is_running = true;
  const swap_count = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', () => {
      is_running = false;
      resolve(Number(printed));
    });
  });
  return { swap_count, is_running: () => is_running };
}
