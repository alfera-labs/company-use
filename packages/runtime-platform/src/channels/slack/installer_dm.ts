import type { Database } from '@coworker/core';
import { find_active_slack_connection_for_workspace } from '@runtime-platform/channels/slack/workspace_connection';
import {
  lookup_slack_user_id_by_email,
  open_slack_dm_channel,
  post_slack_message,
  read_slack_authed_user_id,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';

export async function send_slack_dm_to_installer(
  db: Database,
  input: { workspace_id: string; email?: string | null | undefined; text: string },
): Promise<boolean> {
  const connection = await find_active_slack_connection_for_workspace(db, input.workspace_id);
  const token = connection ? read_slack_bot_token(connection) : null;
  if (!connection || !token) return false;

  const slack_user_id =
    read_slack_authed_user_id(connection) ??
    (input.email ? await lookup_slack_user_id_by_email(token, input.email) : null);
  if (!slack_user_id) return false;

  const dm_channel = await open_slack_dm_channel(token, slack_user_id);
  if (!dm_channel) return false;

  await post_slack_message(token, dm_channel, input.text);
  return true;
}
