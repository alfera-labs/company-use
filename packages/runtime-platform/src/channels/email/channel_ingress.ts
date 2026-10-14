import { createHmac } from 'node:crypto';

import { AppError, ValidationError } from '@coworker/shared';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import type {
  ChannelIngressAdapter,
  ChannelIngressResult,
} from '@runtime-platform/channels/channel_ingress';
import { prepare_email_channel_event_jobs } from '@runtime-platform/channels/email/channel_event_queue';
import { z } from 'zod';

// Resend webhook ingress for the managed email channel. Resend signs deliveries with Svix
// headers; the signed content is `${svix-id}.${svix-timestamp}.${body}` HMAC-SHA256 keyed by
// the endpoint's whsec_ secret. Mirrors the Slack adapter: unset secret skips verification in
// dev and is a named 500 in production.

const resend_webhook_body_schema = z
  .object({
    type: z.string().min(1),
    data: z
      .object({
        email_id: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export const email_channel_ingress_adapter: ChannelIngressAdapter = {
  channel_provider_key: 'email',
  verify_and_parse_request: verify_and_parse_resend_request,
  prepare_event: prepare_email_channel_event_jobs,
};

export async function verify_and_parse_resend_request(
  request: Request,
): Promise<ChannelIngressResult> {
  const body_text = await request.text();
  verify_resend_webhook_signature(request.headers, body_text);
  const body = parse_resend_webhook_body(body_text);

  return {
    kind: 'event',
    event: {
      channel_provider_key: 'email',
      provider_event_id: body.data.email_id,
      received_time: new Date(),
      raw_event: body,
      provider_event_type: body.type,
    },
  };
}

function parse_resend_webhook_body(body_text: string) {
  const parsed = resend_webhook_body_schema.safeParse(parse_json(body_text));
  if (!parsed.success) {
    throw new ValidationError('Resend webhook body failed validation', parsed.error.flatten());
  }
  return parsed.data;
}

function parse_json(body_text: string) {
  try {
    return JSON.parse(body_text) as unknown;
  } catch {
    throw new ValidationError('Resend webhook body must be valid JSON');
  }
}

function verify_resend_webhook_signature(headers: Headers, body_text: string) {
  const signing_secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!signing_secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(
        'resend_webhook_secret_missing',
        'RESEND_INBOUND_WEBHOOK_SECRET is required to receive email events in production.',
        500,
      );
    }
    return;
  }

  const message_id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!message_id || !timestamp || !signatures) {
    throw new AppError('resend_signature_missing', 'Svix signature headers are required.', 401);
  }

  const timestamp_seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestamp_seconds)) {
    throw new AppError('resend_signature_invalid', 'Svix timestamp is invalid.', 401);
  }
  const now_seconds = Math.floor(Date.now() / 1000);
  if (Math.abs(now_seconds - timestamp_seconds) > 60 * 5) {
    throw new AppError('resend_signature_expired', 'Svix timestamp is too old.', 401);
  }

  const expected = build_svix_signature(signing_secret, message_id, timestamp, body_text);
  const provided = signatures
    .split(' ')
    .map((entry) => entry.split(',')[1])
    .filter((signature): signature is string => Boolean(signature));
  if (!provided.some((signature) => secure_strings_equal(signature, expected))) {
    throw new AppError('resend_signature_invalid', 'Svix signature is invalid.', 401);
  }
}

function build_svix_signature(
  signing_secret: string,
  message_id: string,
  timestamp: string,
  body_text: string,
) {
  const secret_bytes = Buffer.from(signing_secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', secret_bytes)
    .update(`${message_id}.${timestamp}.${body_text}`)
    .digest('base64');
}
