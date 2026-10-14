import { revoke_connection_as_user } from '@api/services/connections/connection_service';
import { cancel_session_run } from '@api/services/sessions/stop_session_run';
import {
  authorize_team_change,
  refuse_to_lose_the_last_owner,
  require_team_member,
  type TeamTarget,
} from '@api/services/team/team_members';
import type { Database } from '@coworker/core';
import {
  list_live_connections_made_by,
  type MemberConnection,
} from '@coworker/core/db/queries/member_connections';
import {
  cancel_waiting_messages_of_person,
  disable_scheduled_tasks_of,
  list_going_runs_of_person,
  revoke_api_keys_made_by,
} from '@coworker/core/db/queries/removed_member_work';
import { deactivate_team_member, lock_team } from '@coworker/core/db/queries/team_members';
import { end_team_sessions_of_removed_member } from '@coworker/core/db/queries/team_sessions';
import { delete_unused_team_sign_in_links } from '@coworker/core/db/queries/team_sign_in_links';
import {
  create_logger,
  format_error_message,
  session_agent_message_job_handler,
} from '@coworker/shared';
import { api_session_turn_job_handler } from '@runtime-platform/events/api_session_turn_job';

const log = create_logger('team_member_removal');

export type ConnectionOfRemovedMember = MemberConnection & { disconnected: boolean };

export type RemovedMemberSummary = {
  user_id: string;
  api_keys_revoked: number;
  scheduled_tasks_switched_off: string[];
  waiting_messages_cleared: number;
  runs_stopped: number;
  connections: ConnectionOfRemovedMember[];
};

const message_job_handlers = [session_agent_message_job_handler, api_session_turn_job_handler];

/**
 * The app accounts a person connected, for the one who is about to remove that person: what
 * will be disconnected, and who else uses each one today.
 */
export async function list_connections_of_member(
  db: Database,
  input: TeamTarget,
): Promise<MemberConnection[]> {
  const member = await require_team_member(db, input);
  await authorize_team_change(db, input, { current_role: member.member_role });
  return list_live_connections_made_by(db, input);
}

/**
 * The person is out at once. Their seat, every session and every unused link go in one step
 * (a session leaves a row that signs nobody in and only says "this person was removed"),
 * and so does what would go on working for them with nobody signed in: the API keys they made,
 * and the scheduled tasks they made or last changed. Then their messages that wait for a run
 * are taken back, the runs still going for them are stopped (first the messages, so that no
 * stopped run hands over to the next one), and the app accounts they connected are
 * disconnected unless the remover keeps them.
 * The summary tells the remover what was switched off.
 */
export async function remove_team_member(
  db: Database,
  input: TeamTarget & { keeps_connections: boolean },
): Promise<RemovedMemberSummary> {
  const switched_off = await db.transaction(async (tx) => {
    await lock_team(tx, input.workspace_id);
    const member = await require_team_member(tx, input);
    await authorize_team_change(tx, input, { current_role: member.member_role });
    await refuse_to_lose_the_last_owner(tx, input, member);
    await deactivate_team_member(tx, input);
    await end_team_sessions_of_removed_member(tx, input);
    await delete_unused_team_sign_in_links(tx, input);
    return {
      api_keys_revoked: await revoke_api_keys_made_by(tx, input),
      scheduled_tasks_switched_off: await disable_scheduled_tasks_of(tx, input),
    };
  });
  const waiting_messages_cleared = await cancel_waiting_messages_of_person(db, {
    ...input,
    message_job_handlers,
  });
  const [runs_stopped, connections] = await Promise.all([
    stop_going_runs_of(db, input),
    settle_connections_of(db, input),
  ]);
  return {
    user_id: input.user_id,
    ...switched_off,
    waiting_messages_cleared,
    runs_stopped,
    connections,
  };
}

async function stop_going_runs_of(db: Database, input: TeamTarget): Promise<number> {
  const going_runs = await list_going_runs_of_person(db, input);
  const stops = await Promise.allSettled(
    going_runs.map((run_id) => cancel_session_run(db, { ...input, run_id })),
  );
  return stops.filter((stop) => stop.status === 'fulfilled').length;
}

async function settle_connections_of(
  db: Database,
  input: TeamTarget & { keeps_connections: boolean },
): Promise<ConnectionOfRemovedMember[]> {
  const made = await list_live_connections_made_by(db, input);
  return Promise.all(
    made.map(async (connection) => ({
      ...connection,
      disconnected: !input.keeps_connections && (await disconnect(db, input, connection)),
    })),
  );
}

async function disconnect(db: Database, input: TeamTarget, connection: MemberConnection) {
  try {
    await revoke_connection_as_user(db, {
      workspace_id: input.workspace_id,
      connection_id: connection.connection_id,
      acting_user_id: input.actor_id,
      actor_id: input.actor_id,
    });
    return true;
  } catch (error) {
    log.error('a connection of a removed person could not be disconnected', {
      connection_id: connection.connection_id,
      error: format_error_message(error),
    });
    return false;
  }
}
