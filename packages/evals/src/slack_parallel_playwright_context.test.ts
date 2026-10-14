import { lstat, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { open_slack_parallel_playwright_context } from '@coworker/evals/slack_parallel_playwright_context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playwright_mocks = vi.hoisted(() => ({
  launch_persistent_context: vi.fn(
    async (_directory: string, _options: { env?: Record<string, string | undefined> }) => ({
      close: async () => undefined,
    }),
  ),
}));

vi.mock('@playwright/test', () => ({
  chromium: { launchPersistentContext: playwright_mocks.launch_persistent_context },
}));

const temporary_directories: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(
    temporary_directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('open_slack_parallel_playwright_context', () => {
  it('starts Chrome with a minimal environment that excludes decrypted secrets', async () => {
    const profile_directory = await mkdtemp(path.join(os.tmpdir(), 'slack-parallel-profile-'));
    temporary_directories.push(profile_directory);

    await open_slack_parallel_playwright_context({
      user_data_directory: profile_directory,
      headless: true,
    });

    expect(playwright_mocks.launch_persistent_context).toHaveBeenCalledWith(
      profile_directory,
      expect.objectContaining({
        env: expect.objectContaining({ HOME: expect.any(String), PATH: expect.any(String) }),
      }),
    );
    const launch_options = playwright_mocks.launch_persistent_context.mock.calls[0]?.[1];
    expect(Object.keys(launch_options?.env ?? {}).sort()).toEqual([
      'HOME',
      'LOGNAME',
      'PATH',
      'TMPDIR',
      'USER',
    ]);
  });

  it('refuses to remove or reuse the lock of a running browser profile', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'slack-parallel-profile-'));
    temporary_directories.push(directory);
    const profile_directory = path.join(directory, 'profile');
    const lock_path = path.join(profile_directory, 'SingletonLock');
    await mkdir(profile_directory);
    await symlink('host-1234', lock_path);

    await expect(
      open_slack_parallel_playwright_context({
        user_data_directory: profile_directory,
        headless: true,
      }),
    ).rejects.toThrow('Close that browser cleanly');
    await expect(lstat(lock_path)).resolves.toBeDefined();
  });
});
