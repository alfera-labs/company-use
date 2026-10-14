import { access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { slack_browser_process_environment } from '@coworker/evals/slack_eval_sender';
import { chromium } from '@playwright/test';

export async function open_slack_parallel_playwright_context(input: {
  user_data_directory: string;
  executable_path?: string;
  headless?: boolean;
}) {
  const user_data_directory = require_absolute_directory(input.user_data_directory);
  await access(user_data_directory);
  await reject_profile_in_use(user_data_directory);
  return chromium.launchPersistentContext(user_data_directory, {
    headless: input.headless ?? false,
    viewport: null,
    env: slack_browser_process_environment(),
    ...(input.executable_path
      ? { executablePath: input.executable_path }
      : { channel: 'chrome' as const }),
  });
}

async function reject_profile_in_use(user_data_directory: string) {
  for (const lock_name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    if (await path_exists(path.join(user_data_directory, lock_name))) {
      throw new Error(
        `Slack browser profile is in use (${lock_name}). Close that browser cleanly before starting the parallel Playwright run.`,
      );
    }
  }
}

async function path_exists(pathname: string) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (read_error_code(error) === 'ENOENT') return false;
    throw error;
  }
}

function require_absolute_directory(value: string) {
  if (!path.isAbsolute(value)) throw new Error('user_data_directory must be absolute.');
  return path.resolve(value);
}

function read_error_code(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
