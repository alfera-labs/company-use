import type { Database } from '@coworker/core';
import { workspaces } from '@coworker/core';
import { NotFoundError } from '@coworker/shared';
import { eq, sql } from 'drizzle-orm';

export type SlackDiscoveryWindow = {
  checkpoint_key: string;
  oldest_ts: string | null;
  latest_ts: string;
};

export type UpdateSlackDiscoveryCheckpointInput = {
  workspace_id: string;
  connection_id: string;
  channel_id: string;
  channel_name?: string | null;
  scanned_until_ts: string;
  last_message_ts?: string | null;
  messages_scanned: number;
};

const slack_mirror_key = 'slack_mirror';
const discovery_checkpoints_key = 'discovery_checkpoints';
const backfill_lookback_days = 90;

export async function prepare_slack_discovery_window(
  db: Database,
  input: Pick<UpdateSlackDiscoveryCheckpointInput, 'workspace_id' | 'connection_id' | 'channel_id'>,
  now = new Date(),
): Promise<SlackDiscoveryWindow> {
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.workspace_id, input.workspace_id),
  });
  if (!workspace) throw new NotFoundError('Workspace');

  const checkpoint_key = slack_discovery_checkpoint_key(input);
  const checkpoint = workspace.workspace_data.slack_mirror?.discovery_checkpoints?.[checkpoint_key];
  return {
    checkpoint_key,
    oldest_ts: checkpoint?.last_scanned_ts ?? backfill_start_ts(now),
    latest_ts: date_to_slack_ts(now),
  };
}

function backfill_start_ts(now: Date) {
  return date_to_slack_ts(new Date(now.getTime() - backfill_lookback_days * 24 * 60 * 60 * 1000));
}

export async function update_slack_discovery_checkpoint(
  db: Database,
  input: UpdateSlackDiscoveryCheckpointInput,
) {
  const checkpoint_key = slack_discovery_checkpoint_key(input);
  const updated_at = new Date().toISOString();
  const checkpoint = {
    provider: 'workspace_data',
    format: 'slack-discovery-checkpoint-v1',
    connection_id: input.connection_id,
    channel_id: input.channel_id,
    channel_name: input.channel_name ?? null,
    last_scanned_ts: input.scanned_until_ts,
    last_message_ts: input.last_message_ts ?? null,
    messages_scanned: input.messages_scanned,
    updated_at,
  };

  await db
    .update(workspaces)
    .set({
      workspace_data: slack_discovery_checkpoint_patch_sql({
        checkpoint_key,
        checkpoint,
      }),
      last_updated_time: new Date(),
      last_updated_by: 'system:memory',
    })
    .where(eq(workspaces.workspace_id, input.workspace_id));
}

export function date_to_slack_ts(date: Date) {
  const millis = date.getTime();
  const seconds = Math.floor(millis / 1000);
  const micros = (millis % 1000) * 1000;
  return `${seconds}.${String(micros).padStart(6, '0')}`;
}

function slack_discovery_checkpoint_key(
  input: Pick<UpdateSlackDiscoveryCheckpointInput, 'connection_id' | 'channel_id'>,
) {
  return `${input.connection_id}:${input.channel_id}`;
}

function slack_discovery_checkpoint_patch_sql(input: {
  checkpoint_key: string;
  checkpoint: Record<string, unknown>;
}) {
  return sql`
    ${workspaces.workspace_data} ||
    jsonb_build_object(
      ${slack_mirror_key}::text,
      coalesce(${workspaces.workspace_data} -> ${slack_mirror_key}::text, '{}'::jsonb) ||
      jsonb_build_object(
        ${discovery_checkpoints_key}::text,
        coalesce(${workspaces.workspace_data} #> '{slack_mirror,discovery_checkpoints}', '{}'::jsonb) ||
        jsonb_build_object(${input.checkpoint_key}::text, ${JSON.stringify(input.checkpoint)}::jsonb)
      )
    )
  `;
}
