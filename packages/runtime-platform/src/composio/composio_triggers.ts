import { createHmac } from 'node:crypto';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import {
  type ComposioClient,
  get_composio_client,
} from '@runtime-platform/composio/composio_client';
import { z } from 'zod';

export async function create_composio_trigger_instance(input: {
  trigger_slug: string;
  connected_account_id: string;
  trigger_config?: Record<string, unknown> | undefined;
  client?: ComposioClient | undefined;
}) {
  const client = input.client ?? get_composio_client();
  const result = await client.upsert_trigger_instance(input.trigger_slug, {
    connected_account_id: input.connected_account_id,
    trigger_config: input.trigger_config ?? {},
    toolkit_versions: 'latest',
  });
  return { trigger_id: result.trigger_id };
}

export async function set_composio_trigger_instance_enabled(input: {
  trigger_id: string;
  enabled: boolean;
  client?: ComposioClient | undefined;
}) {
  const client = input.client ?? get_composio_client();
  await client.set_trigger_instance_status(input.trigger_id, input.enabled ? 'enable' : 'disable');
}

export async function delete_composio_trigger_instance(input: {
  trigger_id: string;
  client?: ComposioClient | undefined;
}) {
  const client = input.client ?? get_composio_client();
  await client.delete_trigger_instance(input.trigger_id);
}

export async function list_composio_trigger_instances(input: {
  connected_account_id: string;
  client?: ComposioClient | undefined;
}) {
  const client = input.client ?? get_composio_client();
  return client.list_active_trigger_instances({
    connected_account_ids: [input.connected_account_id],
    show_disabled: true,
  });
}

// Composio signs every webhook with three headers: `webhook-id`, `webhook-timestamp`, and
// `webhook-signature`. The signature is base64 HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.
// {raw_body}`, optionally prefixed with a version and a comma (`v1,<signature>`). The SDK rejects a
// timestamp older than 300 seconds to block replays, so this does too.
// Source: https://docs.composio.dev/docs/setting-up-triggers/subscribing-to-events
const webhook_timestamp_tolerance_seconds = 300;

export function verify_composio_webhook_signature(input: {
  secret: string;
  raw_body: string;
  webhook_id: string;
  signature_header: string;
  timestamp_header?: string | undefined;
  now?: Date | undefined;
}): boolean {
  if (!input.secret || !input.signature_header || !input.webhook_id) return false;

  const timestamp = input.timestamp_header?.trim();
  if (!timestamp) return false;
  if (!webhook_timestamp_is_fresh(timestamp, input.now ?? new Date())) return false;

  const expected = createHmac('sha256', input.secret)
    .update(`${input.webhook_id}.${timestamp}.${input.raw_body}`)
    .digest('base64');
  return secure_strings_equal(expected, read_signature_value(input.signature_header));
}

function read_signature_value(signature_header: string) {
  const [, versioned_signature] = signature_header.trim().split(',');
  return (versioned_signature ?? signature_header).trim();
}

function webhook_timestamp_is_fresh(timestamp: string, now: Date) {
  const sent_seconds = Number(timestamp);
  if (!Number.isFinite(sent_seconds)) return false;
  const age_seconds = Math.abs(now.getTime() / 1000 - sent_seconds);
  return age_seconds <= webhook_timestamp_tolerance_seconds;
}

const composio_webhook_event_schema = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    timestamp: z.string().optional(),
    metadata: z
      .object({
        log_id: z.string().optional(),
        trigger_slug: z.string(),
        trigger_id: z.string().optional(),
        connected_account_id: z.string().optional(),
        auth_config_id: z.string().optional(),
        user_id: z.string().optional(),
      })
      .passthrough(),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

export type ComposioWebhookEvent = z.infer<typeof composio_webhook_event_schema>;

export function read_composio_webhook_event(payload: unknown): ComposioWebhookEvent | null {
  const parsed = composio_webhook_event_schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
