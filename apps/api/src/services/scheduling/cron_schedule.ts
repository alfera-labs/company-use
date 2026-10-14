import { create_aws_eventbridge_schedule } from '@api/services/scheduling/adapters/aws_eventbridge';
import { create_google_cloud_schedule } from '@api/services/scheduling/adapters/google_cloud';
import { env } from '@coworker/config';
import { arm_clock, uses_rivet_event_job_dispatch } from '@coworker/jobs';
import type { TriggerSchedule } from '@coworker/runtime-platform';

export type CronSchedule = {
  supports_run_once: boolean;
  set_schedule: (schedule: TriggerSchedule) => Promise<void>;
  pause_schedule: (trigger_id: string) => Promise<void>;
  delete_schedule: (trigger_id: string) => Promise<void>;
};

const noop_cron_schedule: CronSchedule = {
  supports_run_once: true,
  set_schedule: async () => {},
  pause_schedule: async () => {},
  delete_schedule: async () => {},
};

const rivet_clock_schedule: CronSchedule = {
  ...noop_cron_schedule,
  set_schedule: async () => arm_clock(Date.now() + 5_000),
};

let selected_schedule: Promise<CronSchedule> | null = null;

export function get_cron_schedule(): Promise<CronSchedule> {
  if (selected_schedule) return selected_schedule;
  selected_schedule = resolve_cron_schedule().catch((error) => {
    selected_schedule = null;
    throw error;
  });
  return selected_schedule;
}

async function resolve_cron_schedule(): Promise<CronSchedule> {
  if (uses_rivet_event_job_dispatch()) return rivet_clock_schedule;
  if (!scheduler_provisioning_enabled()) return noop_cron_schedule;

  if (env.AWS_SCHEDULER_ROLE_ARN) {
    if (current_api_url_can_receive_scheduler_callbacks()) return create_aws_eventbridge_schedule();
    return noop_cron_schedule;
  }
  if (env.GCP_PROJECT_ID && public_callback_base_url()) {
    return create_google_cloud_schedule(env.GCP_PROJECT_ID);
  }
  return noop_cron_schedule;
}

function scheduler_provisioning_enabled() {
  return (
    env.NODE_ENV === 'production' ||
    env.ENVIRONMENT === 'production' ||
    env.ENVIRONMENT === 'staging' ||
    env.SCHEDULER_PROVISIONING === 'enabled'
  );
}

function current_api_url_can_receive_scheduler_callbacks(): boolean {
  return is_public_https_url(env.API_URL);
}

function public_callback_base_url(): string | undefined {
  return env.GCP_SCHEDULER_TARGET_BASE_URL ?? env.API_PUBLIC_URL;
}

function is_public_https_url(value: string | undefined): boolean {
  if (!value) return false;
  const url = URL.parse(value);
  return url?.protocol === 'https:' && !is_local_hostname(url.hostname);
}

function is_local_hostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}
