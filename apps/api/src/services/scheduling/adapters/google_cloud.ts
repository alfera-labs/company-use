import { proxy_auth_headers } from '@api/lib/proxy_identity';
import type { CronSchedule } from '@api/services/scheduling/cron_schedule';
import { env } from '@coworker/config';
import type { TriggerSchedule } from '@coworker/runtime-platform';
import { CloudSchedulerClient } from '@google-cloud/scheduler';

const already_exists_code = 6;
const not_found_code = 5;

const fast_call_options = { timeout: 5_000, maxRetries: 1 };

export function create_google_cloud_schedule(project_id: string): CronSchedule {
  const client = new CloudSchedulerClient();
  const location = env.GCP_REGION;
  const location_path = client.locationPath(project_id, location);
  const job_path = (trigger_id: string) =>
    client.jobPath(project_id, location, scheduler_job_name(trigger_id));

  return {
    supports_run_once: false,
    set_schedule: async (schedule) => {
      const job = build_scheduler_job(job_path(schedule.trigger_id), schedule);
      try {
        await client.createJob({ parent: location_path, job }, fast_call_options);
      } catch (error) {
        if (status_code(error) !== already_exists_code) throw error;
        await client.updateJob({ job }, fast_call_options);
      }
    },
    pause_schedule: (trigger_id) =>
      ignore_missing_job(client.pauseJob({ name: job_path(trigger_id) }, fast_call_options)),
    delete_schedule: (trigger_id) =>
      ignore_missing_job(client.deleteJob({ name: job_path(trigger_id) }, fast_call_options)),
  };
}

function scheduler_job_name(trigger_id: string) {
  return `coworker-trigger-${trigger_id}`;
}

function build_scheduler_job(name: string, schedule: TriggerSchedule) {
  return {
    name,
    schedule: schedule.cron_expression,
    ...(schedule.timezone ? { timeZone: schedule.timezone } : {}),
    httpTarget: {
      uri: `${trigger_fire_base_url()}/v1/events/${schedule.trigger_id}`,
      httpMethod: 'POST' as const,
      headers: { [proxy_auth_headers.secret]: require_api_proxy_secret() },
    },
  };
}

function trigger_fire_base_url() {
  const base = env.GCP_SCHEDULER_TARGET_BASE_URL ?? env.API_PUBLIC_URL ?? env.API_URL;
  if (!base) {
    throw new Error('GCP_SCHEDULER_TARGET_BASE_URL, API_PUBLIC_URL, or API_URL is required');
  }
  return base.replace(/\/$/, '');
}

function require_api_proxy_secret() {
  const secret = env.COWORKER_API_PROXY_SECRET;
  if (!secret) throw new Error('COWORKER_API_PROXY_SECRET is required to schedule triggers');
  return secret;
}

async function ignore_missing_job(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (status_code(error) !== not_found_code) throw error;
  }
}

function status_code(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: number }).code
    : undefined;
}
