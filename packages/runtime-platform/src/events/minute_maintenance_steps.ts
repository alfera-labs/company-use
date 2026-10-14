import type { Database } from '@coworker/core';
import { enqueue_daily_connector_canary } from '@runtime-platform/events/connector_canary_job';

/** The work the worker does once a minute. The log of each minute names every step here. */
export const minute_maintenance_steps = {
  daily_connector_canary: (db: Database) => enqueue_daily_connector_canary(db),
} as const;
