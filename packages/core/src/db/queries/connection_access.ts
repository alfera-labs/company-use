import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import type { ConnectionConfigData } from '@coworker/core/db/schema/json_column_types';
import { built_in_connection_status } from '@coworker/core/integrations/alfera_api_tools';
import { is_workspace_administrator_role } from '@coworker/shared';

export type ConnectionAccessType = 'shared' | 'restricted';

export type AllowedUser = {
  user_id: string;
  can_delete?: boolean;
  can_edit_tools?: boolean;
};

export type ConnectionAccessConfig = {
  connection_access_type?: ConnectionAccessType;
  access?: { allowed_users?: AllowedUser[] };
};

export type ConnectionPermissions = {
  can_use: boolean;
  can_manage: boolean;
  can_delete: boolean;
};

export function read_connection_access(config: ConnectionConfigData): {
  access_type: ConnectionAccessType;
  allowed_users: AllowedUser[];
} {
  const block: ConnectionAccessConfig = config;
  if (block?.connection_access_type !== 'restricted') {
    return { access_type: 'shared', allowed_users: [] };
  }
  const allowed_users = Array.isArray(block.access?.allowed_users)
    ? block.access.allowed_users.filter(
        (entry): entry is AllowedUser => typeof entry?.user_id === 'string',
      )
    : [];
  return { access_type: 'restricted', allowed_users };
}

/**
 * The access of a connection whose maker did not choose one. Several people share a team-mode
 * install, so there an account one person connects is that person's alone until they share
 * it. Everywhere else a new connection is for the whole workspace, as before, and the input
 * comes back untouched.
 */
export function with_access_for_a_new_connection<
  Input extends { access_type?: ConnectionAccessType | undefined },
>(input: Input): Input {
  if (input.access_type || !is_team_mode_switched_on()) return input;
  return { ...input, access_type: 'restricted' };
}

export function build_restricted_access_config(owner_user_id: string): ConnectionAccessConfig {
  return {
    connection_access_type: 'restricted',
    access: {
      allowed_users: [{ user_id: owner_user_id, can_delete: true, can_edit_tools: true }],
    },
  };
}

export function read_connection_permissions(input: {
  allowed_users: readonly AllowedUser[];
  connected_by: string | null | undefined;
  acting_user_id: string | null | undefined;
  member_role: string | null | undefined;
  connection_status: string;
}): ConnectionPermissions {
  const permissions = read_person_permissions(input);
  if (input.connection_status === built_in_connection_status) {
    return { ...permissions, can_delete: false };
  }
  return permissions;
}

function read_person_permissions(input: {
  allowed_users: readonly AllowedUser[];
  connected_by: string | null | undefined;
  acting_user_id: string | null | undefined;
  member_role: string | null | undefined;
}): ConnectionPermissions {
  const { allowed_users, connected_by, acting_user_id, member_role } = input;
  const connector_or_admin_manages_whoever_it_is_shared_with = Boolean(
    acting_user_id &&
      (connected_by === acting_user_id || is_workspace_administrator_role(member_role)),
  );
  if (allowed_users.length === 0) {
    return {
      can_use: true,
      can_manage: connector_or_admin_manages_whoever_it_is_shared_with,
      can_delete: connector_or_admin_manages_whoever_it_is_shared_with,
    };
  }
  const entry = allowed_users.find((user) => user.user_id === acting_user_id);
  return {
    can_use: entry !== undefined,
    can_manage:
      connector_or_admin_manages_whoever_it_is_shared_with || entry?.can_edit_tools === true,
    can_delete: connector_or_admin_manages_whoever_it_is_shared_with || entry?.can_delete === true,
  };
}
