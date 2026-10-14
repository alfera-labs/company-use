import { afterEach, describe, expect, it, vi } from 'vitest';
import runtime_env_keys_file from '@/runtime_env_keys.json';

const dotenvx_config = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn<(path: string) => boolean>());

vi.mock('@dotenvx/dotenvx', () => ({
  config: dotenvx_config,
}));

vi.mock('node:fs', () => ({
  existsSync,
}));

const required_runtime_env_keys = [
  'NODE_ENV',
  'ENVIRONMENT',
  'API_URL',
  'COWORKER_API_PROXY_SECRET',
  'AUTH_HINT_COOKIE_DOMAIN',
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'WORKOS_REDIRECT_URI',
  'SENTRY_DSN',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_ENVIRONMENT',
  'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  'NEXT_PUBLIC_SENTRY_DSN',
];

const native_vercel_env: Record<string, string> = {
  ...Object.fromEntries(required_runtime_env_keys.map((key) => [key, `native-${key}`])),
  NODE_ENV: 'production',
};

const original_env: Record<string, string | undefined> = Object.fromEntries(
  [...Object.keys(native_vercel_env), 'VERCEL'].map((key) => [key, process.env[key]]),
);

describe('decrypt_vercel_runtime_env', () => {
  afterEach(() => {
    for (const [key, value] of Object.entries(original_env)) {
      restore_env(key, value);
    }

    dotenvx_config.mockReset();
    existsSync.mockReset();
    vi.resetModules();
  });

  it('declares exactly the runtime env keys the app cannot start without', () => {
    expect(runtime_env_keys_file.required_runtime_env_keys).toEqual(required_runtime_env_keys);
  });

  it.each(required_runtime_env_keys)('treats native env as incomplete without %s', async (key) => {
    set_native_vercel_env();
    delete process.env[key];

    const { has_vercel_native_runtime_env } = await import('@/instrumentation_node');

    expect(has_vercel_native_runtime_env(process.env)).toBe(false);
  });

  it('skips dotenvx decrypt when native Vercel runtime env is complete', async () => {
    process.env.VERCEL = '1';
    set_native_vercel_env();

    const { decrypt_vercel_runtime_env, has_vercel_native_runtime_env } = await import(
      '@/instrumentation_node'
    );

    expect(has_vercel_native_runtime_env(process.env)).toBe(true);

    decrypt_vercel_runtime_env();

    expect(existsSync).not.toHaveBeenCalled();
    expect(dotenvx_config).not.toHaveBeenCalled();
  });

  it('falls back to encrypted runtime env when native Vercel runtime env is incomplete', async () => {
    process.env.VERCEL = '1';
    set_native_vercel_env();
    delete process.env.COWORKER_API_PROXY_SECRET;
    existsSync.mockReturnValue(true);

    const { decrypt_vercel_runtime_env, has_vercel_native_runtime_env } = await import(
      '@/instrumentation_node'
    );

    expect(has_vercel_native_runtime_env(process.env)).toBe(false);

    decrypt_vercel_runtime_env();

    expect(existsSync).toHaveBeenCalledWith(expect.stringContaining('.env.runtime.enc'));
    expect(dotenvx_config).toHaveBeenCalledWith({
      ignore: ['MISSING_ENV_FILE'],
      overload: true,
      path: [expect.stringContaining('.env.runtime.enc')],
    });
  });
});

function set_native_vercel_env() {
  for (const [key, value] of Object.entries(native_vercel_env)) {
    process.env[key] = value;
  }
}

function restore_env(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
