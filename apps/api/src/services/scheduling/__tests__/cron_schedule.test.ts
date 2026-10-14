import { afterEach, describe, expect, it, vi } from 'vitest';

const sample = { trigger_id: 'trg_1', cron_expression: '0 9 * * *' };

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@coworker/config');
});

async function load_with_env(env: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@coworker/config', () => ({ env }));
  return import('@api/services/scheduling/cron_schedule');
}

describe('get_cron_schedule selection', () => {
  it('no-ops when a GCP project is set but no public callback URL is configured', async () => {
    const { get_cron_schedule } = await load_with_env({
      NODE_ENV: 'production',
      GCP_PROJECT_ID: 'example-project',
      GCP_SCHEDULER_TARGET_BASE_URL: undefined,
      API_PUBLIC_URL: undefined,
    });
    const schedule = await get_cron_schedule();
    await expect(schedule.set_schedule(sample)).resolves.toBeUndefined();
  });

  it('no-ops when there is no GCP project at all', async () => {
    const { get_cron_schedule } = await load_with_env({
      NODE_ENV: 'production',
      GCP_PROJECT_ID: undefined,
      GCP_SCHEDULER_TARGET_BASE_URL: 'https://api.example.com',
      API_PUBLIC_URL: undefined,
    });
    const schedule = await get_cron_schedule();
    await expect(schedule.set_schedule(sample)).resolves.toBeUndefined();
  });

  it('selects the AWS adapter when AWS_SCHEDULER_ROLE_ARN is set', async () => {
    const create_aws = vi.fn(async () => ({
      supports_run_once: true,
      set_schedule: vi.fn(async () => {}),
      pause_schedule: vi.fn(async () => {}),
      delete_schedule: vi.fn(async () => {}),
    }));
    vi.resetModules();
    vi.doMock('@coworker/config', () => ({
      env: {
        AWS_SCHEDULER_ROLE_ARN: 'arn:aws:iam::1:role/x',
        API_URL: 'https://current-api.example.com',
        GCP_PROJECT_ID: 'p',
        NODE_ENV: 'production',
      },
    }));
    vi.doMock('@api/services/scheduling/adapters/aws_eventbridge', () => ({
      create_aws_eventbridge_schedule: create_aws,
    }));
    const { get_cron_schedule } = await import('@api/services/scheduling/cron_schedule');
    await (await get_cron_schedule()).set_schedule(sample);
    expect(create_aws).toHaveBeenCalledTimes(1);
    vi.doUnmock('@api/services/scheduling/adapters/aws_eventbridge');
  });

  it('no-ops when AWS is configured but the current API_URL is local', async () => {
    const create_aws = vi.fn(async () => ({
      supports_run_once: true,
      set_schedule: vi.fn(async () => {}),
      pause_schedule: vi.fn(async () => {}),
      delete_schedule: vi.fn(async () => {}),
    }));
    vi.resetModules();
    vi.doMock('@coworker/config', () => ({
      env: {
        AWS_SCHEDULER_ROLE_ARN: 'arn:aws:iam::1:role/x',
        API_URL: 'http://localhost:3001',
        GCP_PROJECT_ID: 'p',
        GCP_SCHEDULER_TARGET_BASE_URL: 'https://api.example.com',
        NODE_ENV: 'production',
      },
    }));
    vi.doMock('@api/services/scheduling/adapters/aws_eventbridge', () => ({
      create_aws_eventbridge_schedule: create_aws,
    }));
    const { get_cron_schedule } = await import('@api/services/scheduling/cron_schedule');
    await (await get_cron_schedule()).set_schedule(sample);
    expect(create_aws).not.toHaveBeenCalled();
    vi.doUnmock('@api/services/scheduling/adapters/aws_eventbridge');
  });

  it('no-ops in development even when AWS config and a public API_URL are present', async () => {
    const create_aws = vi.fn(async () => ({
      supports_run_once: true,
      set_schedule: vi.fn(async () => {}),
      pause_schedule: vi.fn(async () => {}),
      delete_schedule: vi.fn(async () => {}),
    }));
    vi.resetModules();
    vi.doMock('@coworker/config', () => ({
      env: {
        AWS_SCHEDULER_ROLE_ARN: 'arn:aws:iam::1:role/x',
        API_URL: 'https://api.example.com',
        GCP_PROJECT_ID: 'p',
        API_PUBLIC_URL: 'https://api.example.com',
        ENVIRONMENT: 'development',
        NODE_ENV: 'development',
      },
    }));
    vi.doMock('@api/services/scheduling/adapters/aws_eventbridge', () => ({
      create_aws_eventbridge_schedule: create_aws,
    }));
    const { get_cron_schedule } = await import('@api/services/scheduling/cron_schedule');
    await (await get_cron_schedule()).set_schedule(sample);
    expect(create_aws).not.toHaveBeenCalled();
    vi.doUnmock('@api/services/scheduling/adapters/aws_eventbridge');
  });
});
