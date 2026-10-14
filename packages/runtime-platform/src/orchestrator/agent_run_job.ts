import type { Database, event_jobs } from '@coworker/core';
import { get_run } from '@coworker/core/db/queries/sessions';
import type { LiveEventPublisher } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import { publish_live_run_event } from '@runtime-platform/chat_stream/live_run_events';
import { run_can_continue } from '@runtime-platform/orchestrator/run_resume';
import {
  type AgentRunStreamEvent,
  type StartAgentRunInput,
  type StartAgentRunOptions,
  start_agent_run,
} from '@runtime-platform/orchestrator/runtime_orchestrator';

const log = create_logger('agent_run_job');

type EventJob = typeof event_jobs.$inferSelect;

export type AgentRunJob = {
  started_run_id?: string;
  record_started_run_id?: (run_id: string) => Promise<void>;
  stop_signal?: AbortSignal;
  live_events?: LiveEventPublisher;
};

export function read_agent_run_job(input: {
  event_jobs?: readonly EventJob[] | undefined;
  record_started_run_id?: ((run_id: string) => Promise<void>) | undefined;
  signal?: AbortSignal | undefined;
  live_events?: LiveEventPublisher | undefined;
}): AgentRunJob {
  const started_run_id = input.event_jobs?.find((job) => job.run_id)?.run_id ?? undefined;
  return {
    ...(started_run_id ? { started_run_id } : {}),
    ...(input.record_started_run_id ? { record_started_run_id: input.record_started_run_id } : {}),
    ...(input.signal ? { stop_signal: input.signal } : {}),
    ...(input.live_events ? { live_events: input.live_events } : {}),
  };
}

export async function start_agent_run_for_job(
  db: Database,
  input: StartAgentRunInput,
  job: AgentRunJob | undefined,
  options: StartAgentRunOptions = {},
) {
  const resume_run_id = await find_run_to_continue(db, input, job?.started_run_id);
  return start_agent_run(
    db,
    { ...input, ...(resume_run_id ? { resume_run_id } : {}) },
    {
      ...options,
      ...(job?.stop_signal ? { stop_signal: job.stop_signal } : {}),
      on_stream_event: async (event) => {
        if (event.type === 'run_created') await job?.record_started_run_id?.(event.run.run_id);
        if (job?.live_events) publish_to_live_socket(job.live_events, event);
        await options.on_stream_event?.(event);
      },
    },
  );
}

function publish_to_live_socket(live_events: LiveEventPublisher, event: AgentRunStreamEvent) {
  try {
    publish_live_run_event(live_events, event);
  } catch (error) {
    log.error('the live socket could not take a run event', {
      event_type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function find_run_to_continue(
  db: Database,
  input: StartAgentRunInput,
  started_run_id: string | undefined,
) {
  if (!started_run_id) return undefined;
  const run = await get_run(db, input.workspace_id, started_run_id);
  if (!run || !run_can_continue(run)) return undefined;
  if (run.session_id !== input.session_id) {
    log.warn('the job started a run in another session; starting a new run instead', {
      workspace_id: input.workspace_id,
      run_id: run.run_id,
      session_id: input.session_id,
    });
    return undefined;
  }
  return run.run_id;
}
