import type { Database } from '@coworker/core';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  load_slack_user_directory,
  type SlackMember,
} from '@runtime-platform/channels/slack/directory';
import { find_active_slack_connection_for_workspace } from '@runtime-platform/channels/slack/workspace_connection';
import { read_slack_bot_token } from '@runtime-platform/tools/slack/channels_api';

const log = create_logger('workspace_slack_people');

export type WorkspaceSlackPerson = {
  slack_user_id: string;
  name: string;
  email: string | null;
  is_guest: boolean;
};

export type WorkspaceSlackPeople = {
  connected: boolean;
  people: WorkspaceSlackPerson[];
  lookup_failed?: true;
};

// The Slack directory stops at 5000 users, so a larger Slack workspace lists only the
// first 5000 people; look people up by email when a workspace that large connects.
export async function list_workspace_slack_people(
  db: Database,
  workspace_id: string,
): Promise<WorkspaceSlackPeople> {
  const connection = await find_active_slack_connection_for_workspace(db, workspace_id);
  if (!connection) return { connected: false, people: [] };

  try {
    const token = read_slack_bot_token(connection);
    if (!token) throw new Error('The Slack connection has no bot token.');
    const directory = await load_slack_user_directory(token);
    const people = directory.members.filter((member) => !member.is_bot).map(to_slack_person);
    return { connected: true, people };
  } catch (error) {
    log.error('Slack people lookup failed', { workspace_id, error: format_error_message(error) });
    return { connected: true, people: [], lookup_failed: true };
  }
}

function to_slack_person(member: SlackMember): WorkspaceSlackPerson {
  return {
    slack_user_id: member.user_id,
    name: member.real_name ?? member.display_name ?? member.email ?? member.user_id,
    email: member.email,
    is_guest: member.is_guest,
  };
}
