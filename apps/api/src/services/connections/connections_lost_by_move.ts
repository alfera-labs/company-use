import type { Database } from '@coworker/core';
import { build_participants } from '@coworker/core/access/build_participants';
import { may_use_resource, type Participants } from '@coworker/core/access/may_use_resource';
import { read_resource_type_definition } from '@coworker/core/access/resource_types';
import { list_redacted_connections } from '@coworker/core/db/queries/connection_management';
import { find_project } from '@coworker/core/db/queries/projects';
import {
  list_grants_for_resources,
  read_grant_rules,
} from '@coworker/core/db/queries/resource_grants';
import type {
  SessionMetadata,
  SessionSourceMetadataData,
} from '@coworker/core/db/schema/json_column_types';

type SessionReach = {
  project_id: string | null;
  session_metadata: SessionMetadata;
  source_metadata: SessionSourceMetadataData | null;
  agent_id: string;
};

export async function list_connections_lost_by_move(
  db: Database,
  input: { workspace_id: string; before: SessionReach; after: SessionReach },
): Promise<string[]> {
  const before = await reach_of(db, input.workspace_id, input.before);
  const after = await reach_of(db, input.workspace_id, input.after);
  const connections = (await list_redacted_connections(db, input.workspace_id)).filter(
    (connection) => connection.connection_status === 'active',
  );
  const grants_by_connection = await list_grants_for_resources(db, {
    workspace_id: input.workspace_id,
    resource_type: 'connection',
    resource_ids: connections.map((connection) => connection.connection_id),
  });
  const default_access = read_resource_type_definition('connection').default_access;

  return connections
    .filter((connection) => {
      const grants = read_grant_rules(grants_by_connection.get(connection.connection_id) ?? []);
      const owner_user_id = connection.connected_by;
      const reaches = (side: Reach) =>
        may_use_resource({
          default_access,
          grants,
          participants: side.participants,
          owner_user_id,
          room_private_to: side.room_private_to,
        }).allowed;
      return reaches(before) && !reaches(after);
    })
    .map(
      (connection) =>
        connection.connection_name ?? connection.app?.app_display_name ?? 'Connection',
    );
}

type Reach = { participants: Participants; room_private_to: string | null };

async function reach_of(db: Database, workspace_id: string, session: SessionReach): Promise<Reach> {
  const project = session.project_id
    ? await find_project(db, { workspace_id, project_id: session.project_id })
    : null;
  return {
    participants: build_participants({
      project_id: session.project_id,
      session_metadata: session.session_metadata,
      session_source_metadata: session.source_metadata,
      agent_ids: [session.agent_id],
    }),
    room_private_to: project?.personal_for_user_id ?? null,
  };
}
