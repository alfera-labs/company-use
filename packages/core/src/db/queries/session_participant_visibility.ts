import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import { memory_scope_resource_type } from '@coworker/core/access/resource_types';
import { project_is_visible_to_user } from '@coworker/core/db/queries/project_visibility';
import { sessions } from '@coworker/core/db/schema';
import { type SQL, sql } from 'drizzle-orm';

/**
 * A session with no project that a person started is visible only to its own
 * participants. A participant is the session's creator, a user who authored an entry in it, or,
 * for a Slack channel session, a member of that channel's memory audience. With
 * no participant evidence at all, only the creator sees it.
 *
 * A session with no project that no person started (an automation, email, or other `system:`
 * run) belongs to the workspace, so every reader sees it.
 *
 * Team mode has one exception: the chat of a scheduled task or of an automation run. A person
 * made that work, so its chat goes in that person's own room. One that is in no room is from
 * before that rule, and nobody reads it here until it runs again and is moved.
 */
export function session_is_visible_to_reader(workspace_id: string, reader_user_id: string): SQL {
  return sql`(
    (
      ${sessions.project_id} IS NOT NULL
      AND ${project_is_visible_to_user(workspace_id, reader_user_id, sessions.project_id)}
    )
    OR (
      ${sessions.project_id} IS NULL
      AND ${session_has_no_project_is_visible_to_reader(workspace_id, reader_user_id)}
    )
  )`;
}

function session_has_no_project_is_visible_to_reader(
  workspace_id: string,
  reader_user_id: string,
): SQL {
  return sql`(
    ${no_person_started_the_session()}
    OR ${sessions.created_by} = ${reader_user_id}
    OR ${reader_authored_a_message(reader_user_id)}
    OR ${reader_is_in_the_sessions_channel_audience(workspace_id, reader_user_id)}
  )`;
}

function no_person_started_the_session(): SQL {
  const started_by_the_system = sql`${sessions.created_by} LIKE 'system:%'`;
  if (!is_team_mode_switched_on()) return started_by_the_system;
  return sql`(${started_by_the_system} AND ${sessions.session_source} <> 'trigger')`;
}

function reader_authored_a_message(reader_user_id: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM "session_tree_entries" AS entry
    WHERE entry."session_id" = ${sessions.session_id}
      AND entry."actor_id" = ${reader_user_id}
  )`;
}

const slack_channel_scope_key = sql`'group:slack:' || (${sessions.source_metadata} -> 'slack' ->> 'team_id') || ':' || (${sessions.source_metadata} -> 'slack' ->> 'channel_id')`;

function reader_is_in_the_sessions_channel_audience(
  workspace_id: string,
  reader_user_id: string,
): SQL {
  return sql`(
    (${sessions.source_metadata} -> 'slack' ->> 'channel_id') IS NOT NULL
    AND coalesce(${sessions.source_metadata} -> 'slack' ->> 'channel_type', '') <> 'im'
    AND EXISTS (
      SELECT 1 FROM "resource_grants" AS channel_grant
      LEFT JOIN "source_actors" AS linked_source_actor
        ON linked_source_actor."source_actor_id" = channel_grant."grantee_id"
        AND linked_source_actor."workspace_id" = channel_grant."workspace_id"
      WHERE channel_grant."workspace_id" = ${workspace_id}
        AND channel_grant."resource_type" = ${memory_scope_resource_type}
        AND channel_grant."resource_id" = ${slack_channel_scope_key}
        AND (
          (channel_grant."grantee_type" = 'user' AND channel_grant."grantee_id" = ${reader_user_id})
          OR (
            channel_grant."grantee_type" = 'source_actor'
            AND linked_source_actor."member_link_state" = 'linked'
            AND linked_source_actor."linked_user_id" = ${reader_user_id}
          )
        )
    )
  )`;
}
