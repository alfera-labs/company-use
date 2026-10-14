import type { Database } from '@coworker/core';
import { runtime_attachment_limits } from '@runtime-platform/attachments/runtime_attachment_source';
import { create_slack_attachment_sources } from '@runtime-platform/channels/slack/attachment_sources';
import { find_active_slack_connection_for_workspace_team } from '@runtime-platform/channels/slack/workspace_connection';
import type { StartAgentRunInput } from '@runtime-platform/orchestrator/runtime_orchestrator';
import type { ScoutSlackActivity } from '@runtime-platform/scout/slack_activity';
import { read_slack_bot_token } from '@runtime-platform/tools/slack/channels_api';

type SelectedScoutAttachment = {
  team_id: string;
  attachment: ScoutSlackActivity['attachments'][number];
};

export async function prepare_scout_attachments(
  db: Database,
  workspace_id: string,
  activity: ScoutSlackActivity[],
) {
  const selected = select_scout_attachments(activity);
  if (selected.length === 0) return { activity, sources: [] };

  const selected_ids = new Set(selected.map((item) => item.attachment.attachment_id));
  const prompt_activity = activity.map((message) =>
    keep_selected_attachments(message, selected_ids),
  );
  const team_ids = [...new Set(selected.map((item) => item.team_id))];
  const source_groups = await Promise.all(
    team_ids.map((team_id) => create_team_attachment_sources(db, workspace_id, team_id, selected)),
  );
  return { activity: prompt_activity, sources: source_groups.flat() };
}

export function build_scout_user_content(
  prompt: string,
  attachment_sources: NonNullable<StartAgentRunInput['attachment_sources']>,
): NonNullable<StartAgentRunInput['user_content']> {
  return [
    { type: 'text', text: prompt },
    ...attachment_sources.map((source) => ({
      type: 'file' as const,
      file_id: source.attachment_id,
      name: source.file_name,
      mime_type: source.mime_type,
    })),
  ];
}

function select_scout_attachments(activity: ScoutSlackActivity[]) {
  const selected: SelectedScoutAttachment[] = [];
  const selected_ids = new Set<string>();
  let selected_bytes = 0;

  for (const message of activity) {
    if (!message.team_id) continue;
    for (const attachment of message.attachments) {
      const byte_size = attachment.byte_size ?? 0;
      if (selected_ids.has(attachment.attachment_id)) continue;
      if (selected.length >= runtime_attachment_limits.max_attachments) continue;
      if (byte_size > runtime_attachment_limits.max_attachment_bytes) continue;
      if (selected_bytes + byte_size > runtime_attachment_limits.max_request_bytes) continue;
      selected.push({ team_id: message.team_id, attachment });
      selected_ids.add(attachment.attachment_id);
      selected_bytes += byte_size;
    }
  }
  return selected;
}

function keep_selected_attachments(
  message: ScoutSlackActivity,
  selected_ids: Set<string>,
): ScoutSlackActivity {
  const attachments = message.attachments.filter((file) => selected_ids.has(file.attachment_id));
  const omitted_attachment_count = message.attachments.length - attachments.length;
  return {
    ...message,
    attachments,
    ...(omitted_attachment_count > 0 ? { omitted_attachment_count } : {}),
  };
}

async function create_team_attachment_sources(
  db: Database,
  workspace_id: string,
  team_id: string,
  selected: SelectedScoutAttachment[],
) {
  const connection = await find_active_slack_connection_for_workspace_team(db, {
    workspace_id,
    team_id,
  });
  const token = read_slack_bot_token(connection);
  if (!connection || !token) {
    throw new Error(`No active Slack file connection exists for team ${team_id}.`);
  }
  return create_slack_attachment_sources(
    token,
    team_id,
    selected.filter((item) => item.team_id === team_id).map((item) => item.attachment),
  );
}
