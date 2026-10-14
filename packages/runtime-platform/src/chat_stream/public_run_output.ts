import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import { AppError } from '@coworker/shared';
import type { ChatStreamEvent } from '@runtime-platform/chat_stream/chat_stream_events';
import { public_persisted_chat_event } from '@runtime-platform/chat_stream/public_session_reads';
import type { AgentRunStreamEvent } from '@runtime-platform/orchestrator/runtime_orchestrator';

export const public_run_failure_message = "The run couldn't be completed. Please try again.";

export const session_busy_message = 'Still finishing the previous task, one moment.';

const passthrough_error_codes = new Set(['card_required', 'out_of_credits']);

export function public_run_stream_error(error: unknown) {
  if (error instanceof AppError && error.code === 'conflict') {
    return { code: 'session_busy', message: session_busy_message };
  }
  if (error instanceof AppError && passthrough_error_codes.has(error.code)) {
    return { code: error.code, message: error.message };
  }
  return { code: 'stream_error', message: public_run_failure_message };
}

type RunWithError = {
  error_message?: string | null;
};

type RunEventWithError = {
  event_type: string;
  event_label: string | null;
  event_data: unknown;
};

export function public_run<T extends RunWithError>(run: T): T {
  if (!run.error_message) return run;
  return { ...run, error_message: public_run_failure_message };
}

export function public_run_event<T extends RunEventWithError>(event: T): T {
  if (event.event_type === 'chat_event') {
    return {
      ...event,
      event_data: public_persisted_chat_event(event.event_data as ChatStreamEvent),
    };
  }
  if (event.event_type !== 'error') return event;
  return {
    ...event,
    event_label: public_run_failure_message,
    event_data: {
      event_type: 'error',
      message: public_run_failure_message,
      source: 'runtime',
    },
  };
}

export function public_chat_stream_event(event: ChatStreamEvent): ChatStreamEvent {
  const bounded = public_persisted_chat_event(event);
  if (bounded.event_type !== 'stream_error' && bounded.event_type !== 'item_failed') return bounded;
  return {
    ...bounded,
    error: { ...bounded.error, message: public_run_failure_message },
  };
}

export function public_agent_run_stream_event(event: AgentRunStreamEvent): AgentRunStreamEvent {
  if (event.type === 'run_created' || event.type === 'run_updated') {
    return { ...event, run: public_run(event.run) };
  }
  if (event.type === 'chat_event') {
    return { ...event, event: public_chat_stream_event(event.event) };
  }
  if (event.type === 'runtime_event') {
    return { ...event, event: public_runtime_event(event.event) };
  }
  return event;
}

function public_runtime_event(event: RuntimeRunEvent): RuntimeRunEvent {
  if (event.event_type !== 'error') return event;
  return {
    ...event,
    error: { ...event.error, message: public_run_failure_message },
  };
}
