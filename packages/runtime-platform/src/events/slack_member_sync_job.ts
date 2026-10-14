import type { Database, event_jobs, events } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  find_workspace_slack_connection,
  read_slack_bot_token,
} from '@runtime-platform/channels/slack/history';
import { sync_slack_channel_members } from '@runtime-platform/channels/slack/slack_member_sync';
import { z } from 'zod';

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

export const slack_member_sync_event_source = 'slack_member_sync';

export const slack_member_sync_payload_schema = z
  .object({
    channel_id: z.string().min(1),
    connection_id: z.string().min(1).optional(),
  })
  .strict();

export type SlackMemberSyncPayload = z.infer<typeof slack_member_sync_payload_schema>;

const log = create_logger('slack_member_sync_job');

export async function run_slack_member_sync_job(input: {
  db: Database;
  workspace_id: string;
  event_jobs: EventJob[];
  events: EventRecord[];
}): Promise<EventJobHandlerResult> {
  const payload = read_slack_member_sync_payload(input.events);
  if (!payload) {
    return { job_status: 'failed', error_data: { code: 'slack_member_sync_payload_unreadable' } };
  }

  const connection = await find_workspace_slack_connection(
    input.db,
    input.workspace_id,
    payload.connection_id,
  );
  const token = connection ? read_slack_bot_token(connection.credentials) : null;
  const team_id = connection?.external_account_id ?? null;
  if (!connection || !token || !team_id) {
    return { job_status: 'failed', error_data: { code: 'slack_member_sync_unconfigured' } };
  }

  try {
    const result = await sync_slack_channel_members({
      db: input.db,
      workspace_id: input.workspace_id,
      team_id,
      channel_id: payload.channel_id,
      token,
      sweep_id: sweep_id_for(input.events),
      swept_time: new Date(),
      actor_id: 'system',
    });
    if (result.outcome !== 'swept') {
      return { job_status: 'failed', error_data: { code: result.outcome } };
    }
    return {
      job_status: 'done',
      result_data: { added: result.added, removed: result.removed },
    };
  } catch (error) {
    const message = format_error_message(error);
    log.error('slack member sync failed', { channel_id: payload.channel_id, error: message });
    return {
      job_status: 'failed',
      error_data: { code: 'slack_member_sync_failed', message },
    };
  }
}

function read_slack_member_sync_payload(records: EventRecord[]): SlackMemberSyncPayload | null {
  const record = records.find((event) => event.source === slack_member_sync_event_source);
  if (!record) return null;
  const parsed = slack_member_sync_payload_schema.safeParse(record.event_body);
  if (!parsed.success) {
    log.error(`queued member sync ${record.event_id} has an unusable payload`, parsed.error);
    return null;
  }
  return parsed.data;
}

function sweep_id_for(records: EventRecord[]): string {
  const record = records.find((event) => event.source === slack_member_sync_event_source);
  return record?.event_id ?? `slack_member_sync_${Date.now()}`;
}
