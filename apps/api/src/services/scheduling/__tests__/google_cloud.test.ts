import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = {
  createJob: vi.fn(async (_request: unknown) => {}),
  updateJob: vi.fn(async (_request: unknown) => {}),
  pauseJob: vi.fn(async (_request: unknown) => {}),
  deleteJob: vi.fn(async (_request: unknown) => {}),
};

vi.mock('@google-cloud/scheduler', () => ({
  CloudSchedulerClient: class {
    locationPath = (project: string, location: string) =>
      `projects/${project}/locations/${location}`;
    jobPath = (project: string, location: string, name: string) =>
      `projects/${project}/locations/${location}/jobs/${name}`;
    createJob = calls.createJob;
    updateJob = calls.updateJob;
    pauseJob = calls.pauseJob;
    deleteJob = calls.deleteJob;
  },
}));

vi.mock('@coworker/config', () => ({
  env: {
    GCP_REGION: 'us-central1',
    GCP_SCHEDULER_TARGET_BASE_URL: 'https://api.example.com',
    API_PUBLIC_URL: undefined,
    API_URL: undefined,
    COWORKER_API_PROXY_SECRET: 'a-test-secret-at-least-16-chars',
  },
}));

const { create_google_cloud_schedule } = await import(
  '@api/services/scheduling/adapters/google_cloud'
);

const schedule = { trigger_id: 'trg_abc', cron_expression: '0 9 * * *', timezone: 'Europe/Rome' };

type SchedulerJob = {
  schedule: string;
  timeZone?: string;
  httpTarget: { uri: string; httpMethod: string; headers: Record<string, string> };
};

function captured_job(create_job: (typeof calls)['createJob']): SchedulerJob {
  const arg = create_job.mock.calls[0]?.[0] as { job: SchedulerJob } | undefined;
  if (!arg) throw new Error('createJob was not called');
  return arg.job;
}

describe('google cloud scheduler adapter', () => {
  beforeEach(() => {
    for (const fn of Object.values(calls)) fn.mockReset().mockResolvedValue(undefined);
  });

  it('creates a job targeting /v1/events/{trigger_id} with the proxy-secret header', async () => {
    await create_google_cloud_schedule('proj').set_schedule(schedule);

    expect(calls.createJob).toHaveBeenCalledTimes(1);
    const job = captured_job(calls.createJob);
    expect(job.httpTarget.uri).toBe('https://api.example.com/v1/events/trg_abc');
    expect(job.httpTarget.httpMethod).toBe('POST');
    expect(job.httpTarget.headers['x-coworker-api-secret']).toBe('a-test-secret-at-least-16-chars');
    expect(job.schedule).toBe('0 9 * * *');
    expect(job.timeZone).toBe('Europe/Rome');
  });

  it('falls back to updateJob when the job already exists', async () => {
    calls.createJob.mockRejectedValueOnce({ code: 6 });
    await create_google_cloud_schedule('proj').set_schedule(schedule);
    expect(calls.updateJob).toHaveBeenCalledTimes(1);
  });

  it('rethrows create errors that are not ALREADY_EXISTS', async () => {
    calls.createJob.mockRejectedValueOnce({ code: 13 });
    await expect(create_google_cloud_schedule('proj').set_schedule(schedule)).rejects.toMatchObject(
      {
        code: 13,
      },
    );
    expect(calls.updateJob).not.toHaveBeenCalled();
  });

  it('ignores NOT_FOUND on pause and delete', async () => {
    calls.pauseJob.mockRejectedValueOnce({ code: 5 });
    calls.deleteJob.mockRejectedValueOnce({ code: 5 });
    const scheduler = create_google_cloud_schedule('proj');
    await expect(scheduler.pause_schedule('trg_abc')).resolves.toBeUndefined();
    await expect(scheduler.delete_schedule('trg_abc')).resolves.toBeUndefined();
  });

  it('rethrows pause/delete errors that are not NOT_FOUND', async () => {
    calls.deleteJob.mockRejectedValueOnce({ code: 7 });
    await expect(
      create_google_cloud_schedule('proj').delete_schedule('trg_abc'),
    ).rejects.toMatchObject({
      code: 7,
    });
  });

  it('throws when no target base url is configured', async () => {
    vi.resetModules();
    vi.doMock('@coworker/config', () => ({
      env: {
        GCP_REGION: 'us-central1',
        GCP_SCHEDULER_TARGET_BASE_URL: undefined,
        API_PUBLIC_URL: undefined,
        API_URL: undefined,
        COWORKER_API_PROXY_SECRET: 'a-test-secret-at-least-16-chars',
      },
    }));
    const fresh = await import('@api/services/scheduling/adapters/google_cloud');
    await expect(fresh.create_google_cloud_schedule('proj').set_schedule(schedule)).rejects.toThrow(
      /TARGET_BASE_URL, API_PUBLIC_URL, or API_URL/,
    );
    vi.doUnmock('@coworker/config');
  });
});
