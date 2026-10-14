import { pause_listen_ears_for_connection } from '@api/services/automations/listen_ears';
import {
  assert_connection_deleter,
  assert_connection_manager,
  run_user_connection_action,
  type UserConnectionAction,
} from '@api/services/connections/connection_action_guard';
import {
  add_connection_person,
  project_people_onto_connection_config,
  remove_connection_person,
} from '@api/services/connections/connection_people_service';
import { connections_a_person_sees } from '@api/services/connections/connection_reader_service';
import { say_when_connection_cannot_work } from '@api/services/connections/connection_that_cannot_work';
import type { Database } from '@coworker/core/db/connection';
import { list_app_ids_with_newer_connector } from '@coworker/core/db/queries/catalog_twin_offer';
import type { AllowedUser } from '@coworker/core/db/queries/connection_access';
import {
  type ConnectionAccessType,
  read_connection_permissions,
} from '@coworker/core/db/queries/connection_access';
import {
  get_redacted_connection,
  list_redacted_connections,
  patch_connection,
  reconnect_connection,
  revoke_connection,
} from '@coworker/core/db/queries/connection_management';
import {
  list_connection_people,
  read_people_of_connection,
} from '@coworker/core/db/queries/connection_people';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { redact_connection } from '@coworker/core/integrations/connection_dto';
import { generate_connection_health_report } from '@coworker/core/integrations/connection_health_report';
import { create_logger, format_error_message, NotFoundError } from '@coworker/shared';
import { find_connection_provider_adapter } from '@runtime-platform/connections/connection_provider_adapters';

const log = create_logger('connection_service');

export async function get_connection_managed_by_user(db: Database, input: UserConnectionAction) {
  const connection = await get_redacted_connection(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
  });
  if (!connection) throw new NotFoundError('Connection');
  await assert_connection_manager(db, connection, input);
  return connection;
}
export async function list_connections_for_user(
  db: Database,
  input: { workspace_id: string; acting_user_id: string },
) {
  const member_role = await find_active_workspace_member_role(db, {
    workspace_id: input.workspace_id,
    user_id: input.acting_user_id,
  });
  const connections = await list_redacted_connections(
    db,
    input.workspace_id,
    connections_a_person_sees(input.acting_user_id, member_role).acting_user_id,
  );
  const [people_by_connection, app_ids_with_newer_connector] = await Promise.all([
    list_connection_people(db, {
      workspace_id: input.workspace_id,
      connection_ids: connections.map((connection) => connection.connection_id),
    }),
    list_app_ids_with_newer_connector(
      db,
      connections.map((connection) => connection.app_id),
    ),
  ]);
  return connections.map((connection) => {
    const allowed_users = people_by_connection.get(connection.connection_id) ?? [];
    return {
      ...project_people_onto_connection_config(connection, allowed_users),
      ...(app_ids_with_newer_connector.has(connection.app_id) ? { has_newer_connector: true } : {}),
      ...say_when_connection_cannot_work(connection),
      permissions: read_connection_permissions({
        allowed_users,
        connected_by: connection.connected_by,
        acting_user_id: input.acting_user_id,
        member_role,
        connection_status: connection.connection_status,
      }),
    };
  });
}
export async function check_connection_health_as_user(db: Database, input: UserConnectionAction) {
  return run_user_connection_action(db, input, async (transaction, connection) => {
    await assert_connection_manager(transaction, connection, input);
    return { ...connection, health: generate_connection_health_report(connection) };
  });
}
export async function add_connection_access_member(
  db: Database,
  input: UserConnectionAction & { member: AllowedUser },
) {
  return run_user_connection_action(db, input, async (transaction, connection) => {
    await assert_connection_manager(transaction, connection, input);
    const people = await add_connection_person(transaction, input);
    return project_people_onto_connection_config(redact_connection(connection), people);
  });
}
export async function remove_connection_access_member(
  db: Database,
  input: UserConnectionAction & { member_user_id: string },
) {
  return run_user_connection_action(db, input, async (transaction, connection) => {
    await assert_connection_manager(transaction, connection, input);
    const people = await remove_connection_person(transaction, input);
    return project_people_onto_connection_config(redact_connection(connection), people);
  });
}
export async function patch_connection_as_user(
  db: Database,
  input: UserConnectionAction & {
    connection_name?: string | undefined;
    access_type?: ConnectionAccessType | undefined;
  },
) {
  return run_user_connection_action(db, input, async (transaction, connection) => {
    await assert_connection_manager(transaction, connection, input);
    const current_access_type =
      (await read_people_of_connection(transaction, input)).length === 0 ? 'shared' : 'restricted';
    const next_access_type =
      input.access_type === current_access_type ? undefined : input.access_type;

    const patched = await patch_connection(transaction, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      ...(input.connection_name === undefined ? {} : { connection_name: input.connection_name }),
      ...(next_access_type === undefined ? {} : { access_type: next_access_type }),
      actor_id: input.actor_id,
    });
    return project_people_onto_connection_config(
      patched,
      await read_people_of_connection(transaction, input),
    );
  });
}
export async function reconnect_connection_as_user(
  db: Database,
  input: UserConnectionAction & { redirect_uri?: string | undefined },
) {
  return run_user_connection_action(db, input, async (transaction, connection) => {
    await assert_connection_manager(transaction, connection, input);
    return reconnect_connection(transaction, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      ...(input.redirect_uri ? { redirect_uri: input.redirect_uri } : {}),
      actor_id: input.actor_id,
    });
  });
}
export async function revoke_connection_as_user(db: Database, input: UserConnectionAction) {
  const revoked = await run_user_connection_action(db, input, async (transaction, connection) => {
    await assert_connection_deleter(transaction, connection, input);
    return revoke_connection(transaction, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      actor_id: input.actor_id,
    });
  });
  await delete_provider_account_of_revoked_connection(revoked);
  await pause_listen_ears_for_connection(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    actor_id: input.actor_id,
  });
  return revoked;
}

async function delete_provider_account_of_revoked_connection(connection: {
  connection_id: string;
  provider_key: string | null;
  external_account_id: string | null;
  provider_account?: Record<string, unknown>;
}) {
  const adapter = find_connection_provider_adapter(connection.provider_key);
  if (!adapter?.revoke_external_account) return;

  try {
    await adapter.revoke_external_account(connection);
  } catch (error) {
    log.error('Could not delete the provider account of a revoked connection', {
      connection_id: connection.connection_id,
      provider_key: connection.provider_key,
      error: format_error_message(error),
    });
  }
}
