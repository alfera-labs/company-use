import type { DatabaseExecutor } from '@coworker/core';
import type { Participants } from '@coworker/core/access/may_use_resource';
import { AppError } from '@coworker/shared';
import { list_connections_with_access } from '@runtime-platform/connections/connection_snapshot';

export type TriggerGathering = {
  participants: Participants;
  room_private_to: string | null;
};

export function gathering_of_the_signer_alone(actor_id: string): TriggerGathering {
  return {
    participants: { project: [], user: [actor_id], agent: [] },
    room_private_to: actor_id,
  };
}

export const account_gone_code = 'connection_not_connected';

export async function choose_trigger_account(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    app_id: string;
    connection_id: string | undefined;
    gathering: TriggerGathering;
  },
) {
  const rows = await list_active_app_connections(db, input);
  if (input.connection_id === undefined) return rows.find((row) => row.usable)?.connection ?? null;
  const named = rows.find((row) => row.connection.connection_id === input.connection_id);
  if (!named) throw new AppError(account_gone_code, 'That account is no longer connected.', 422);
  if (!named.usable)
    throw new AppError('access_denied', 'That connection is private to somebody else.', 403);
  return named.connection;
}

async function list_active_app_connections(
  db: DatabaseExecutor,
  input: { workspace_id: string; app_id: string; gathering: TriggerGathering },
) {
  const rows = await list_connections_with_access(db, {
    workspace_id: input.workspace_id,
    ...input.gathering,
  });
  return rows
    .filter(
      ({ connection }) =>
        connection.app_id === input.app_id && connection.connection_status === 'active',
    )
    .sort((a, b) => b.connection.created_time.getTime() - a.connection.created_time.getTime());
}
