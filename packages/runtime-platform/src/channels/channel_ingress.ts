import type { Database } from '@coworker/core';
import { type EnqueueEventInput, enqueue_event_jobs } from '@coworker/core/db/queries/events';
import type { EventRawPayloadData } from '@coworker/core/db/schema/json_column_types';
import { delay_ms_until_first_job_is_ready } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';

const log = create_logger('channel_ingress');

type ChannelHttpStatus = 200 | 202 | 400 | 401 | 403 | 404 | 409 | 422 | 500;

export type ChannelHttpResponse = {
  status: ChannelHttpStatus;
  body: unknown;
};

export type VerifiedChannelEvent = {
  channel_provider_key: string;
  provider_event_id: string;
  received_time: Date;
  raw_event: EventRawPayloadData;
  external_account_id?: string;
  provider_event_type?: string;
};

export type ChannelIngressResult =
  | {
      kind: 'challenge_response';
      response: ChannelHttpResponse;
    }
  | {
      kind: 'event';
      event: VerifiedChannelEvent;
    };

export type AcceptedChannelEvent = {
  accepted: true;
  channel_provider_key: string;
  provider_event_id: string;
  received_time: string;
  external_account_id?: string;
  provider_event_type?: string;
  workspace_id?: string;
  event_id?: string;
  event_status?: string;
  ignored_reason?: string;
  queue_key?: string;
  queued_job_count?: number;
  run_jobs_after_ms?: number;
};

export type ChannelIngressAdapter = {
  channel_provider_key: string;
  verify_and_parse_request: (request: Request) => Promise<ChannelIngressResult>;
  acknowledge_event?: (event: AcceptedChannelEvent) => ChannelHttpResponse;
  prepare_event?: (db: Database, event: VerifiedChannelEvent) => Promise<EnqueueEventInput | null>;
};

export async function accept_channel_event(
  db: Database,
  event: VerifiedChannelEvent,
  adapter?: ChannelIngressAdapter,
): Promise<AcceptedChannelEvent> {
  const accepted_event = build_accepted_channel_event(event);
  if (!adapter?.prepare_event) return accepted_event;

  const prepared_event = await adapter.prepare_event(db, event);
  if (!prepared_event) {
    log_unprepared_channel_event(event);
    return accepted_event;
  }

  const result = await enqueue_event_jobs(db, prepared_event);
  return {
    ...accepted_event,
    workspace_id: prepared_event.workspace_id,
    event_id: result.event.event_id,
    event_status: result.event.event_status,
    ...accepted_event_ignored_reason(prepared_event),
    queue_key: prepared_event.queue_key,
    queued_job_count: result.event_jobs.length,
    run_jobs_after_ms: delay_ms_until_first_job_is_ready(result.event_jobs),
  };
}

function accepted_event_ignored_reason(event: EnqueueEventInput) {
  const metadata_reason = event.metadata?.ignored_reason;
  const body_reason = event.event_body?.ignored_reason;
  const reason =
    typeof metadata_reason === 'string' && metadata_reason.length > 0
      ? metadata_reason
      : typeof body_reason === 'string' && body_reason.length > 0
        ? body_reason
        : null;
  return reason ? { ignored_reason: reason } : {};
}

function log_unprepared_channel_event(event: VerifiedChannelEvent) {
  log.error('Channel event accepted without a prepared queue event', {
    channel_provider_key: event.channel_provider_key,
    provider_event_id: event.provider_event_id,
    external_account_id: event.external_account_id,
    provider_event_type: event.provider_event_type,
  });
}

function build_accepted_channel_event(event: VerifiedChannelEvent): AcceptedChannelEvent {
  return {
    accepted: true,
    channel_provider_key: event.channel_provider_key,
    provider_event_id: event.provider_event_id,
    received_time: event.received_time.toISOString(),
    ...(event.external_account_id === undefined
      ? {}
      : { external_account_id: event.external_account_id }),
    ...(event.provider_event_type === undefined
      ? {}
      : { provider_event_type: event.provider_event_type }),
  };
}

export function acknowledge_accepted_channel_event(
  event: AcceptedChannelEvent,
): ChannelHttpResponse {
  return {
    status: 202,
    body: {
      data: event,
    },
  };
}
