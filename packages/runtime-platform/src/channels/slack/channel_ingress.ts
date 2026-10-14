import { createHmac } from 'node:crypto';

import { AppError, ValidationError } from '@coworker/shared';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import type {
  AcceptedChannelEvent,
  ChannelHttpResponse,
  ChannelIngressAdapter,
  ChannelIngressResult,
} from '@runtime-platform/channels/channel_ingress';
import { prepare_slack_channel_event_jobs } from '@runtime-platform/channels/slack/channel_event_queue';
import { slack_event_body_schema } from '@runtime-platform/channels/slack/slack_event_payload';

export const slack_channel_ingress_adapter: ChannelIngressAdapter = {
  channel_provider_key: 'slack',
  verify_and_parse_request: verify_and_parse_slack_request,
  acknowledge_event: acknowledge_slack_event,
  prepare_event: prepare_slack_channel_event_jobs,
};

async function verify_and_parse_slack_request(request: Request): Promise<ChannelIngressResult> {
  const body_text = await read_verified_slack_request_body(request);
  const body = parse_slack_event_body(body_text);
  if (body.type === 'url_verification') {
    if (!body.challenge) {
      throw new ValidationError('Slack URL verification challenge is required');
    }

    return {
      kind: 'challenge_response',
      response: {
        status: 200,
        body: { challenge: body.challenge },
      },
    };
  }

  if (body.type !== 'event_callback') {
    throw new ValidationError('Unsupported Slack event body type', { type: body.type });
  }

  if (!body.event_id) {
    throw new ValidationError('Slack event callback is missing event_id');
  }

  return {
    kind: 'event',
    event: {
      channel_provider_key: 'slack',
      provider_event_id: body.event_id,
      received_time: new Date(),
      raw_event: body,
      ...(body.team_id === undefined ? {} : { external_account_id: body.team_id }),
      ...read_slack_provider_event_type(body.event),
    },
  };
}

export async function read_verified_slack_request_body(request: Request) {
  const body_text = await request.text();
  verify_slack_signature(request.headers, body_text);
  return body_text;
}

function acknowledge_slack_event(event: AcceptedChannelEvent): ChannelHttpResponse {
  return {
    status: 200,
    body: {
      data: event,
    },
  };
}

function parse_slack_event_body(body_text: string) {
  const body = parse_json(body_text);
  const parsed = slack_event_body_schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Slack event body failed validation', parsed.error.flatten());
  }

  return parsed.data;
}

function parse_json(body_text: string) {
  try {
    return JSON.parse(body_text) as unknown;
  } catch {
    throw new ValidationError('Slack event body must be valid JSON');
  }
}

function verify_slack_signature(headers: Headers, body_text: string) {
  const signing_secret = process.env.SLACK_SIGNING_SECRET;
  if (!signing_secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(
        'slack_signing_secret_missing',
        'SLACK_SIGNING_SECRET is required to receive Slack events in production.',
        500,
      );
    }
    return;
  }

  const timestamp = headers.get('x-slack-request-timestamp');
  const signature = headers.get('x-slack-signature');
  if (!timestamp || !signature) {
    throw new AppError('slack_signature_missing', 'Slack signature headers are required.', 401);
  }

  const timestamp_seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestamp_seconds)) {
    throw new AppError('slack_signature_invalid', 'Slack signature timestamp is invalid.', 401);
  }

  const now_seconds = Math.floor(Date.now() / 1000);
  if (Math.abs(now_seconds - timestamp_seconds) > 60 * 5) {
    throw new AppError('slack_signature_expired', 'Slack signature timestamp is too old.', 401);
  }

  const expected_signature = build_slack_signature(signing_secret, timestamp, body_text);
  if (!secure_strings_equal(signature, expected_signature)) {
    throw new AppError('slack_signature_invalid', 'Slack signature is invalid.', 401);
  }
}

function build_slack_signature(signing_secret: string, timestamp: string, body_text: string) {
  const base_string = `v0:${timestamp}:${body_text}`;
  return `v0=${createHmac('sha256', signing_secret).update(base_string).digest('hex')}`;
}

function read_slack_provider_event_type(event: unknown) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return {};
  const type = (event as Record<string, unknown>).type;
  return typeof type === 'string' ? { provider_event_type: type } : {};
}
