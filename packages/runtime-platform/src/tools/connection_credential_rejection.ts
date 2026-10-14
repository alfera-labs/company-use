import type { Database } from '@coworker/core';
import { mark_connection_credential_rejected } from '@coworker/core/db/queries/connection_management';
import { create_logger, format_error_message, type RuntimeToolResult } from '@coworker/shared';
import type { ToolConnection } from '@runtime-platform/tools/catalog_tool_types';

const log = create_logger('connection_credential_rejection');

export async function record_rejected_connection_credential(
  db: Database,
  input: {
    workspace_id: string;
    actor_id: string;
    connection: ToolConnection;
    rejection_detail: string;
  },
) {
  try {
    await mark_connection_credential_rejected(db, {
      workspace_id: input.workspace_id,
      connection_id: input.connection.connection_id,
      actor_id: input.actor_id,
      rejection_detail: input.rejection_detail,
    });
  } catch (error) {
    log.error('Could not record a rejected connection credential', {
      workspace_id: input.workspace_id,
      connection_id: input.connection.connection_id,
      error: format_error_message(error),
    });
  }
}

export async function record_credential_expiry(
  db: Database,
  input: {
    workspace_id: string;
    actor_id: string;
    connection: ToolConnection | null | undefined;
  },
  result: RuntimeToolResult,
): Promise<RuntimeToolResult> {
  if (result.success || result.error?.code !== 'credential_expired') return result;
  if (!input.connection) return result;

  await record_rejected_connection_credential(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    connection: input.connection,
    rejection_detail: result.error.message,
  });
  return result;
}

export function connection_expired_message(account_name: string | null) {
  return (
    `The saved credential for ${account_name} was refused by the provider, so this connection is ` +
    `now marked unhealthy. Retrying will not help and there is no token to refresh. ` +
    `Call runtime-propose_app_sign_in-1 to give the user a reconnect link, then tell them ` +
    `plainly that the connection expired and you will finish the moment it is back.`
  );
}
