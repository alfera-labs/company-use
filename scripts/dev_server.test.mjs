import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Runs the real scripts/dev-server.sh from a throwaway repository copy, so `start` launches nothing
// of this worktree: the copy has no package.json, and its dev tree exits at once.
function run_dev_server(env_local, ...args) {
  const repository = mkdtempSync(join(tmpdir(), 'dev-server-'));
  mkdirSync(join(repository, 'scripts'));
  copyFileSync(new URL('./dev-server.sh', import.meta.url), join(repository, 'scripts/dev-server.sh'));
  writeFileSync(join(repository, '.env.local'), env_local);
  const script = join(repository, 'scripts/dev-server.sh');
  const result = spawnSync('bash', [script, ...args], { encoding: 'utf8', timeout: 60_000 });
  spawnSync('bash', [script, 'stop'], { encoding: 'utf8', timeout: 60_000 });
  rmSync(repository, { recursive: true, force: true });
  return `${result.stdout}${result.stderr}`;
}

// Every way start_dev_tree reports a launch that ended. Which one wins is a race: a dev tree that exits
// at once can be gone before the script reads its process group (Linux CI), or still alive (macOS).
const dev_tree_launch_ended =
  /dev server (failed to launch|exited during startup|reported a startup error)/;

async function find_free_port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return String(port);
}

test('start with a cloud endpoint starts no local engine and goes on to the dev tree', async () => {
  const output = run_dev_server(
    'RIVET_ENDPOINT=https://api-us-west-1.rivet.dev\nRIVET_TOKEN=sk_test\nAPI_PORT=1\n',
    'start',
    await find_free_port(),
  );
  assert.doesNotMatch(output, /RIVET_ENGINE_PORT or RIVET_TOKEN is missing/);
  assert.doesNotMatch(output, /rivet engine/);
  assert.match(output, dev_tree_launch_ended);
});

test('start with a local endpoint still starts the local engine first', async () => {
  const output = run_dev_server(
    'RIVET_ENDPOINT=http://127.0.0.1:27420\nAPI_PORT=1\n',
    'start',
    await find_free_port(),
  );
  assert.match(output, /RIVET_ENGINE_PORT or RIVET_TOKEN is missing/);
  assert.doesNotMatch(output, dev_tree_launch_ended);
});
