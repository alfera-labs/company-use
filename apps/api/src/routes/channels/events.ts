import type { ApiEnv } from '@api/lib/context';
import { decide_from_slack_click } from '@api/services/policies/slack_approval_click';
import { run_queue_jobs_in_the_background } from '@coworker/jobs';
import {
  type AcceptedChannelEvent,
  accept_channel_event,
  acknowledge_accepted_channel_event,
  type ChannelHttpResponse,
  find_event_job_handler,
  get_channel_ingress_adapter,
  read_verified_slack_request_body,
} from '@coworker/runtime-platform';
import { create_logger } from '@coworker/shared';
import { type Context, Hono } from 'hono';

const log = create_logger('channel_events');
const legacy_slack_platform_channel_key = 'slack-platform';

export const channel_event_routes = new Hono<ApiEnv>()
  .get('/v1/channels/slack/interactivity', (c) => c.json({ ok: true }))
  .post('/v1/channels/slack/interactivity', receive_slack_interactivity)
  .get('/v1/channels/:channel_provider_key/events', async (c) => {
    return receive_channel_event(c, c.req.param('channel_provider_key'));
  })
  .post('/v1/channels/:channel_provider_key/events', async (c) => {
    return receive_channel_event(c, c.req.param('channel_provider_key'));
  })
  .post('/v1/events/channels/:legacy_channel_provider_key', async (c) => {
    return receive_channel_event(
      c,
      channel_provider_key_for_legacy_event_url(c.req.param('legacy_channel_provider_key')),
    );
  });

// Slack gives an interactive payload three seconds, so the answer is written here and now — an
// event insert and a NOTIFY — and the run that was waiting is resumed in the background by
// `record_the_answer`. Anything Slack sends that is not an approval press stays the no-op it was.
async function receive_slack_interactivity(c: Context<ApiEnv>) {
  const body_text = await read_verified_slack_request_body(c.req.raw);
  const reply = await decide_from_slack_click(c.get('db'), body_text);
  if (!reply) return c.body(null, 200);
  return c.json(reply, 200);
}

async function receive_channel_event(c: Context<ApiEnv>, channel_provider_key: string) {
  // Slack sends button presses as form-encoded `payload=` bodies, and app configs routinely
  // point interactivity at the same request URL as events. An event callback is always JSON,
  // so the content type alone says which one arrived — and a press must decide, not be
  // rejected as a malformed event.
  if (channel_provider_key === 'slack' && request_is_form_encoded(c)) {
    return receive_slack_interactivity(c);
  }
  const adapter = get_channel_ingress_adapter(channel_provider_key);
  const result = await adapter.verify_and_parse_request(c.req.raw);

  if (result.kind === 'challenge_response') {
    return channel_response(c, result.response);
  }

  const accepted_event = await accept_channel_event(c.get('db'), result.event, adapter);
  run_accepted_event_jobs_in_the_background(c.get('db'), accepted_event);
  return channel_response(
    c,
    adapter.acknowledge_event?.(accepted_event) ??
      acknowledge_accepted_channel_event(accepted_event),
  );
}

function request_is_form_encoded(c: Context<ApiEnv>) {
  return (c.req.header('content-type') ?? '').includes('application/x-www-form-urlencoded');
}

function channel_provider_key_for_legacy_event_url(channel_provider_key: string) {
  if (channel_provider_key === legacy_slack_platform_channel_key) return 'slack';
  return channel_provider_key;
}

function channel_response(c: Context<ApiEnv>, response: ChannelHttpResponse) {
  if (typeof response.body === 'string') return c.text(response.body, response.status);
  return c.json(response.body, response.status);
}

function run_accepted_event_jobs_in_the_background(
  db: ApiEnv['Variables']['db'],
  event: AcceptedChannelEvent,
) {
  if (!event.workspace_id || !event.queue_key || !event.queued_job_count) {
    log_unworked_channel_event(event);
    return;
  }
  run_queue_jobs_in_the_background(
    db,
    {
      workspace_id: event.workspace_id,
      queue_key: event.queue_key,
      ...(event.run_jobs_after_ms === undefined ? {} : { delay_ms: event.run_jobs_after_ms }),
    },
    find_event_job_handler,
  );
}

function log_unworked_channel_event(event: AcceptedChannelEvent) {
  const message = `${channel_event_label(event)} — no run started (${skipped_run_reason(event)})`;
  if (!event.workspace_id) {
    log.error(message);
    return;
  }
  log.debug(message);
}

function channel_event_label(event: AcceptedChannelEvent) {
  const context = [
    event.external_account_id ? `account ${event.external_account_id}` : undefined,
    event.workspace_id ? `ws ${event.workspace_id}` : undefined,
    event.queue_key,
  ].filter(Boolean);
  const base = `${event.channel_provider_key} event ${event.provider_event_id}`;
  return context.length > 0 ? `${base} (${context.join(', ')})` : base;
}

function skipped_run_reason(event: AcceptedChannelEvent) {
  if (!event.workspace_id) return 'workspace_missing';
  if (!event.queue_key) return 'subject_missing';
  if (!event.queued_job_count) {
    if (event.event_status === 'ignored') return event.ignored_reason ?? 'event_ignored';
    return 'jobs_missing';
  }
  return 'unknown';
}
