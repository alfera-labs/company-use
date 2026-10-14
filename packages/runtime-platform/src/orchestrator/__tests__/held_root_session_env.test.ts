import type { SessionEnv } from '@agent-core/environment/session_env';
import { hold_root_paths_until_ready } from '@runtime-platform/orchestrator/held_root_session_env';
import { describe, expect, it } from 'vitest';

const log_context = { run_id: 'run_held', workspace_id: 'ws_held' };

function recording_environment(calls: string[]): SessionEnv {
  return {
    env_key: 'held',
    env_kind: 'local',
    read: async (path) => {
      calls.push(`read ${path}`);
      return '';
    },
    write: async (path) => {
      calls.push(`write ${path}`);
    },
    exec: async (input) => {
      calls.push(`exec ${input.command} ${(input.args ?? []).join(' ')}`);
      return { exit_code: 0, stdout: '', stderr: '' };
    },
  };
}

function pending_root() {
  let finish: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { ready, finish };
}

describe('hold_root_paths_until_ready', () => {
  it('runs calls that do not name the held root at once', async () => {
    const calls: string[] = [];
    const root = pending_root();
    const environment = hold_root_paths_until_ready(
      recording_environment(calls),
      [{ root_path: '/memory', ready: root.ready }],
      log_context,
    );

    await environment.read?.('notes/a.md');
    await environment.read?.('/workspace/memory/daily-logs/today.md');
    await environment.exec?.({ command: 'ls', args: ['/memory-old'] });

    expect(calls).toEqual([
      'read notes/a.md',
      'read /workspace/memory/daily-logs/today.md',
      'exec ls /memory-old',
    ]);
  });

  it('holds a call that names the held root, in a path or in a command, until the root is ready', async () => {
    const calls: string[] = [];
    const root = pending_root();
    const environment = hold_root_paths_until_ready(
      recording_environment(calls),
      [{ root_path: '/memory', ready: root.ready }],
      log_context,
    );

    const read = environment.read?.('/memory/person-ana/notes.md');
    const exec = environment.exec?.({ command: 'cat', args: ['/memory/index.md'] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);

    root.finish();
    await Promise.all([read, exec]);
    expect([...calls].sort()).toEqual([
      'exec cat /memory/index.md',
      'read /memory/person-ana/notes.md',
    ]);
  });

  it('holds a write or a command that names the held root past the budget, until the root is ready', async () => {
    const calls: string[] = [];
    const root = pending_root();
    const environment = hold_root_paths_until_ready(
      recording_environment(calls),
      [{ root_path: '/memory', ready: root.ready }],
      log_context,
      20,
    );

    await environment.read?.('/memory/index.md');
    const write = environment.write?.('/memory/person-ana/notes.md', 'edit');
    const exec = environment.exec?.({ command: 'sh', args: ['-c', 'echo x > /memory/a.md'] });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toEqual(['read /memory/index.md']);

    root.finish();
    await Promise.all([write, exec]);
    expect(calls).toEqual([
      'read /memory/index.md',
      'write /memory/person-ana/notes.md',
      'exec sh -c echo x > /memory/a.md',
    ]);
  });

  it('releases the root after the budget, so later calls do not wait again', async () => {
    const calls: string[] = [];
    const environment = hold_root_paths_until_ready(
      recording_environment(calls),
      [{ root_path: '/memory', ready: new Promise<void>(() => undefined) }],
      log_context,
      50,
    );

    const started = performance.now();
    await environment.read?.('/memory/index.md');
    const first_wait_ms = performance.now() - started;
    const again = performance.now();
    await environment.read?.('/memory/index.md');

    expect(first_wait_ms).toBeGreaterThanOrEqual(45);
    expect(performance.now() - again).toBeLessThan(45);
    expect(calls).toEqual(['read /memory/index.md', 'read /memory/index.md']);
  });
});
