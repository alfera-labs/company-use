import type { Database, event_jobs, events } from '@coworker/core';
import type { EventJobProgress } from '@coworker/jobs/queries/event_job_progress';

type EventJob = typeof event_jobs.$inferSelect;
type EventRecord = typeof events.$inferSelect;

export type EventJobStatus =
  | 'waiting'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'dead'
  | 'cancelled';

export type EventJobHandlerResult = {
  job_status: Extract<EventJobStatus, 'done' | 'failed'>;
  run_id?: string;
  result_data?: Record<string, unknown>;
  error_data?: Record<string, unknown>;
  retry_at?: Date;
  retry_counts_as_attempt?: boolean;
};

export type EventJobHandlerControls = {
  heartbeat: () => Promise<void>;
  record_progress: (progress: EventJobProgress) => Promise<void>;
  run_queue_jobs_in_the_background: (input: {
    workspace_id: string;
    queue_key: string;
    delay_ms?: number;
  }) => void;
  record_started_run_id: (run_id: string) => Promise<void>;
  signal: AbortSignal;
  live_events?: LiveEventPublisher;
};

export type LiveEventPublisher = { publish(event: unknown): void };

export type EventJobHandler = {
  job_handler: string;
  run: (
    input: {
      db: Database;
      workspace_id: string;
      queue_key: string;
      event_jobs: EventJob[];
      events: EventRecord[];
    } & EventJobHandlerControls,
  ) => Promise<EventJobHandlerResult>;
};

export type FindEventJobHandler = (job_handler: string) => EventJobHandler | null;
