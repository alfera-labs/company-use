import {
  find_test_runner_marks_refusal,
  validate_api_startup_config,
} from '@api/lib/startup_config';
import { serves_the_test_workspace } from '@api/middleware';
import { RivetEndpointMissingError, require_rivet_connection } from '@coworker/config';
import { describe, expect, it } from 'vitest';

type StartupConfig = NonNullable<Parameters<typeof validate_api_startup_config>[0]>;

function startup_config(overrides: Partial<StartupConfig> = {}): StartupConfig {
  return {
    NODE_ENV: 'development',
    EVENT_JOB_DISPATCH_MODE: 'rivet',
    RIVET_ENDPOINT: 'http://127.0.0.1:6420',
    COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'docker',
    COWORKER_PERSISTENT_WORKSPACES_ENABLED: false,
    ...overrides,
  };
}

describe('validate_api_startup_config', () => {
  it('allows rivet dispatch in local development', () => {
    expect(() => validate_api_startup_config(startup_config())).not.toThrow();
  });

  it('refuses in-process jobs in an API server, and allows them only under unit tests', () => {
    const in_process = startup_config({ EVENT_JOB_DISPATCH_MODE: 'in_process' });
    expect(() => validate_api_startup_config(in_process)).toThrow(/for unit tests only/);
    expect(() => validate_api_startup_config({ ...in_process, NODE_ENV: 'production' })).toThrow(
      /for unit tests only/,
    );
    expect(() => validate_api_startup_config({ ...in_process, NODE_ENV: 'test' })).not.toThrow();
  });

  it('requires a configured machine secret for HTTP dispatch', () => {
    expect(() =>
      validate_api_startup_config(startup_config({ EVENT_JOB_DISPATCH_MODE: 'http' })),
    ).toThrow(/COWORKER_API_PROXY_SECRET.*required/i);
    expect(() =>
      validate_api_startup_config(
        startup_config({
          EVENT_JOB_DISPATCH_MODE: 'http',
          COWORKER_API_PROXY_SECRET: 'too-short',
        }),
      ),
    ).toThrow(/at least 16 characters/i);
  });

  it('allows provider-neutral HTTP dispatch without process forking', () => {
    expect(() =>
      validate_api_startup_config(
        startup_config({
          EVENT_JOB_DISPATCH_MODE: 'http',
          COWORKER_API_PROXY_SECRET: 'configured-proxy-secret',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects Docker and local workspaces in production', () => {
    expect(() =>
      validate_api_startup_config(
        startup_config({ NODE_ENV: 'production', COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'docker' }),
      ),
    ).toThrow(/docker is not supported in production/i);
    expect(() =>
      validate_api_startup_config(
        startup_config({ NODE_ENV: 'production', COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'local' }),
      ),
    ).toThrow(/local is not supported in production/i);
  });

  it('allows Docker workspaces in production only when the self-host switch is on', () => {
    const self_hosted = { NODE_ENV: 'production', COWORKER_SELF_HOSTED: true } as const;
    expect(() =>
      validate_api_startup_config(
        startup_config({ ...self_hosted, COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'docker' }),
      ),
    ).not.toThrow();
    expect(() =>
      validate_api_startup_config(
        startup_config({ ...self_hosted, COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'local' }),
      ),
    ).toThrow(/local is not supported in production/i);
  });

  it('requires an E2B key in production', () => {
    expect(() =>
      validate_api_startup_config(
        startup_config({ NODE_ENV: 'production', COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'e2b' }),
      ),
    ).toThrow(/E2B_API_KEY is required/i);
  });

  it('requires Archil and R2 configuration when production persistence is enabled', () => {
    const persistent = startup_config({
      NODE_ENV: 'production',
      COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'e2b',
      E2B_API_KEY: 'e2b-test-key',
      COWORKER_PERSISTENT_WORKSPACES_ENABLED: true,
    });
    expect(() => validate_api_startup_config(persistent)).toThrow(/ARCHIL_API_KEY/);
    expect(() =>
      validate_api_startup_config({
        ...persistent,
        ARCHIL_API_KEY: 'archil-test-key',
        ARCHIL_REGION: 'aws-us-east-1',
        R2_BUCKET_NAME: 'coworker-test',
        R2_BUCKET_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
        R2_ACCESS_KEY_ID: 'r2-test-key',
        R2_SECRET_ACCESS_KEY: 'r2-test-secret',
        COWORKER_CREDENTIAL_ENCRYPTION_KEY: 'credential-envelope-key',
        COWORKER_BROWSER_STATE_ENCRYPTION_KEY: 'ab'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('does not ask a self-hosted Docker deployment for Archil and R2 configuration', () => {
    expect(() =>
      validate_api_startup_config(
        startup_config({
          NODE_ENV: 'production',
          COWORKER_SELF_HOSTED: true,
          COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'docker',
          COWORKER_PERSISTENT_WORKSPACES_ENABLED: true,
        }),
      ),
    ).not.toThrow();
  });

  it('refuses rivet dispatch without a Rivet endpoint, with a named error', () => {
    const rivet = startup_config({ RIVET_ENDPOINT: undefined });
    expect(() => validate_api_startup_config(rivet)).toThrow(RivetEndpointMissingError);
    expect(() =>
      validate_api_startup_config({ ...rivet, RIVET_ENDPOINT: 'http://127.0.0.1:6420' }),
    ).not.toThrow();
    expect(() =>
      require_rivet_connection({
        RIVET_ENDPOINT: undefined,
        RIVET_NAMESPACE: 'default',
        RIVET_TOKEN: 'token',
        RIVET_REGION: undefined,
      }),
    ).toThrow(RivetEndpointMissingError);
  });
});

describe('the marks of the test runner', () => {
  it('stop a server that runs with NODE_ENV=production', () => {
    expect(find_test_runner_marks_refusal('production', true)).toMatch(
      /VITEST or VITEST_WORKER_ID is set and NODE_ENV=production/,
    );
    expect(find_test_runner_marks_refusal('production', false)).toBeNull();
    expect(find_test_runner_marks_refusal('test', true)).toBeNull();
  });

  it('give the test workspace only to a process that also runs with NODE_ENV=test', () => {
    expect(serves_the_test_workspace('test')).toBe(true);
    expect(serves_the_test_workspace('production')).toBe(false);
    expect(serves_the_test_workspace('development')).toBe(false);
  });
});
