import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import type { EnqueueEventInput } from '@coworker/core/db/queries/events';
import { list_active_workspaces_by_inbound_email_usernames } from '@coworker/core/db/queries/workspace_inbound_email';
import { read_workspace_inbound_email_settings } from '@coworker/core/db/queries/workspace_inbound_email_settings';
import { event_job_queue_barrier_metadata_key } from '@coworker/jobs';
import { create_logger } from '@coworker/shared';
import type { VerifiedChannelEvent } from '@runtime-platform/channels/channel_ingress';
import {
  type EmailEventBody,
  email_event_body_schema,
  resend_received_webhook_schema,
} from '@runtime-platform/channels/email/event_payloads';
import {
  parse_email_address,
  read_inbound_email_username,
} from '@runtime-platform/channels/email/inbound_address';

const log = create_logger('email_channel_event_queue');
const email_agent_message_handler = 'email_agent_message';

export async function prepare_email_channel_event_jobs(
  db: Database,
  event: VerifiedChannelEvent,
): Promise<EnqueueEventInput | null> {
  if (!env.INBOUND_EMAIL_DOMAIN) {
    log_email_event_drop(event, 'inbound_email_domain_unconfigured', log.warn);
    return null;
  }
  if (event.provider_event_type !== 'email.received') {
    log_email_event_drop(event, 'unsupported_webhook_type', log.debug);
    return null;
  }

  const parsed = resend_received_webhook_schema.safeParse(event.raw_event);
  const from_email = parsed.success ? parse_email_address(parsed.data.data.from)?.email : undefined;
  if (!parsed.success || !from_email) {
    log_email_event_drop(event, 'webhook_payload_invalid', log.error);
    return null;
  }
  const email = parsed.data.data;
  const recipients = [...email.to, ...email.cc, ...email.received_for];

  const workspace = await find_recipient_workspace(db, recipients);
  if (!workspace?.inbound_email_username) {
    log_email_event_drop(event, 'recipient_workspace_missing', log.warn, { recipients });
    return null;
  }

  const event_body: EmailEventBody = email_event_body_schema.parse({
    email_id: email.email_id,
    from: email.from,
    from_email,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    ...(email.message_id === undefined ? {} : { message_id: email.message_id }),
    workspace_username: workspace.inbound_email_username,
  });

  const settings = await read_workspace_inbound_email_settings(db, workspace.workspace_id);
  if (!settings.enabled) {
    return ignored_email_event(event, event_body, workspace.workspace_id, 'inbox_disabled');
  }

  if (read_inbound_email_username(from_email)) {
    return ignored_email_event(event, event_body, workspace.workspace_id, 'managed_domain_sender');
  }
  if (is_auto_generated_sender(from_email)) {
    return ignored_email_event(event, event_body, workspace.workspace_id, 'auto_generated_sender');
  }

  return {
    workspace_id: workspace.workspace_id,
    source: 'email',
    source_event_id: `received:${event_body.email_id}`,
    event_type: 'email.received',
    queue_key: `email:${workspace.workspace_id}:received:${event_body.email_id}`,
    actor_key: `email:${from_email}`,
    event_body,
    raw_payload: event.raw_event,
    event_status: 'routed',
    event_jobs: [
      {
        job_handler: email_agent_message_handler,
        metadata: { [event_job_queue_barrier_metadata_key]: true },
      },
    ],
  };
}

async function find_recipient_workspace(db: Database, recipients: string[]) {
  const usernames = recipients.flatMap((recipient) => {
    const username = read_inbound_email_username(recipient);
    return username ? [username] : [];
  });
  const owners = await list_active_workspaces_by_inbound_email_usernames(db, usernames);
  for (const username of usernames) {
    const workspace = owners.find((owner) => owner.answers_to_usernames.includes(username));
    if (workspace) return workspace;
  }
  return null;
}

function is_auto_generated_sender(from_email: string) {
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)[@+.-]/i.test(from_email);
}

function ignored_email_event(
  event: VerifiedChannelEvent,
  event_body: EmailEventBody,
  workspace_id: string,
  reason: string,
): EnqueueEventInput {
  return {
    workspace_id,
    source: 'email',
    source_event_id: `received:${event_body.email_id}`,
    event_type: 'email.received',
    queue_key: `email:${workspace_id}:ignored:${event_body.email_id}`,
    actor_key: `email:${event_body.from_email}`,
    event_body: {
      email_id: event_body.email_id,
      from_email: event_body.from_email,
      subject: event_body.subject,
      ignored_reason: reason,
    },
    raw_payload: event.raw_event,
    event_status: 'ignored',
    metadata: { ignored_reason: reason },
    event_jobs: [],
  };
}

function log_email_event_drop(
  event: VerifiedChannelEvent,
  reason: string,
  emit: (message: string, details?: Record<string, unknown>) => void,
  details: Record<string, unknown> = {},
) {
  emit('email event was not queued', {
    reason,
    provider_event_id: event.provider_event_id,
    provider_event_type: event.provider_event_type,
    ...details,
  });
}
