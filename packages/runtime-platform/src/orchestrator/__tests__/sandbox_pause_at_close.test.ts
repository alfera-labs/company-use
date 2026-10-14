import { stop_e2b_sandbox_instance } from '@runtime-platform/orchestrator/e2b_volume_teardown';
import { afterEach, describe, expect, it, vi } from 'vitest';

function fake_sandbox(overrides: { pause?: () => Promise<boolean>; run_exit_code?: number }) {
  return {
    sandboxId: 'sbx_pause_test',
    pause: vi.fn(overrides.pause ?? (async () => true)),
    kill: vi.fn(async () => true),
    commands: {
      run: vi.fn(async (command: string) => {
        const exit_code = command === 'sync' ? (overrides.run_exit_code ?? 0) : 0;
        if (exit_code !== 0) {
          throw Object.assign(new Error(`exit status ${exit_code}`), {
            name: 'CommandExitError',
            exitCode: exit_code,
            stdout: '',
            stderr: 'injected sync failure',
          });
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    },
  };
}

describe('stop_e2b_sandbox_instance with keep_for_resume', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses instead of killing after a clean teardown', async () => {
    const sandbox = fake_sandbox({});
    const result = await stop_e2b_sandbox_instance(sandbox as never, { keep_for_resume: true });
    expect(result.sandbox_kept).toBe(true);
    expect(sandbox.pause).toHaveBeenCalledTimes(1);
    expect(sandbox.kill).not.toHaveBeenCalled();
  });

  it('kills when the pause is refused twice, and the close still succeeds', async () => {
    vi.useFakeTimers();
    const sandbox = fake_sandbox({
      pause: async () => {
        throw new Error('503: node is busy snapshotting');
      },
    });
    const closing = stop_e2b_sandbox_instance(sandbox as never, { keep_for_resume: true });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await closing;
    expect(result.sandbox_kept).toBe(false);
    expect(sandbox.pause).toHaveBeenCalledTimes(2);
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it('kills without attempting a pause when the teardown itself failed', async () => {
    const sandbox = fake_sandbox({ run_exit_code: 1 });
    await expect(
      stop_e2b_sandbox_instance(sandbox as never, {
        archil_root_path: '/mnt/coworker',
        keep_for_resume: true,
      }),
    ).rejects.toThrow(/teardown failed/i);
    expect(sandbox.pause).not.toHaveBeenCalled();
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it('kills when nobody asked to keep the sandbox', async () => {
    const sandbox = fake_sandbox({});
    const result = await stop_e2b_sandbox_instance(sandbox as never, {});
    expect(result.sandbox_kept).toBe(false);
    expect(sandbox.pause).not.toHaveBeenCalled();
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });
});
