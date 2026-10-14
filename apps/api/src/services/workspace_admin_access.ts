import type { Database } from '@coworker/core';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { AppError, is_workspace_administrator_role } from '@coworker/shared';

export async function authorize_api_key_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'api_key_access_denied',
    message: 'API keys require workspace admin access',
  });
}

export async function authorize_mcp_server_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'mcp_server_access_denied',
    message: 'Adding an MCP server requires workspace admin access',
  });
}

/** The same people who may add an MCP server may have Alfera ask one for its tools again. */
export async function authorize_mcp_server_reading(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'mcp_server_access_denied',
    message:
      'Only an owner or an admin can have Alfera read the tools of an MCP server again. Ask one of them to select Reconnect.',
  });
}

export async function authorize_model_provider_account_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'model_provider_account_access_denied',
    message: 'Managing model provider keys requires workspace admin access',
  });
}

export async function authorize_team_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'team_access_denied',
    message: 'Managing the team requires workspace admin access',
  });
}

export async function authorize_access_table_reading(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'access_table_denied',
    message: 'The access table requires workspace admin access',
  });
}

export async function authorize_dev_settings_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'dev_settings_access_denied',
    message: 'Dev Settings require workspace admin access',
  });
}

export async function authorize_channel_memory_audience_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'channel_memory_audience_access_denied',
    message: 'Changing who counts in a channel requires workspace admin access',
  });
}

export async function authorize_member_link_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'member_link_access_denied',
    message: 'Linking a member account requires workspace admin access',
  });
}

/**
 * The guidance in notification-rules.md is read by every member's automation run and by the
 * scout, and those runs act with their owner's access. So one member must not write it for all.
 */
export async function authorize_notification_guidance_administration(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  await authorize_workspace_admin(db, input, {
    code: 'notification_guidance_access_denied',
    message:
      'Only an owner or an admin can change the guidance that every automation run reads. Ask one of them to change it.',
  });
}

export async function may_change_notification_guidance(
  db: Database,
  input: { workspace_id: string; user_id: string },
): Promise<boolean> {
  return is_workspace_administrator_role(await find_active_workspace_member_role(db, input));
}

async function authorize_workspace_admin(
  db: Database,
  input: { workspace_id: string; user_id: string },
  denial: { code: string; message: string },
) {
  const role = await find_active_workspace_member_role(db, input);
  if (!is_workspace_administrator_role(role)) {
    throw new AppError(denial.code, denial.message, 403);
  }
}
