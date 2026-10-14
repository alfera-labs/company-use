import type { Database } from '@coworker/core';
import {
  find_active_slack_connection_for_workspace,
  load_slack_user_directory,
  most_common_member_timezone,
  read_slack_bot_token,
} from '@coworker/runtime-platform';
import { create_logger, format_error_message } from '@coworker/shared';

const log = create_logger('workspace_timezone');

export async function resolve_workspace_timezone(
  db: Database,
  workspace_id: string,
): Promise<string> {
  try {
    const connection = await find_active_slack_connection_for_workspace(db, workspace_id);
    const token = read_slack_bot_token(connection);
    if (!token) return 'UTC';
    const directory = await load_slack_user_directory(token);
    return most_common_member_timezone(directory) ?? 'UTC';
  } catch (error) {
    log.error('workspace timezone lookup failed, using UTC', {
      workspace_id,
      error: format_error_message(error),
    });
    return 'UTC';
  }
}
