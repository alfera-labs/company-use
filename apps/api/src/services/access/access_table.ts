import {
  read_memory_scope_name_lookup,
  read_memory_scope_rows,
} from '@api/services/access/access_table_memory_scopes';
import type { GranteeType, GrantRule } from '@coworker/core/access/may_use_resource';
import { read_resource_type_definition } from '@coworker/core/access/resource_types';
import { where_a_person_can_use } from '@coworker/core/access/where_a_person_can_use';
import type { Database } from '@coworker/core/db/connection';
import { list_workspace_api_keys } from '@coworker/core/db/queries/api_keys';
import { list_redacted_connections } from '@coworker/core/db/queries/connection_management';
import { list_projects, type ProjectRow } from '@coworker/core/db/queries/projects';
import {
  list_grants_for_resources,
  type ResourceGrantRow,
} from '@coworker/core/db/queries/resource_grants';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import { format_person_name } from '@coworker/shared';

const most_projects_a_workspace_lists = 1000;
const statuses_nobody_can_use = new Set(['pending_setup', 'revoked']);

type Member = Awaited<ReturnType<typeof list_workspace_member_users>>[number];

export async function read_access_table(db: Database, workspace_id: string) {
  const { connections, members, projects } = await read_what_the_table_lists(db, workspace_id);
  const [connection_grants, project_grants, api_keys] = await Promise.all([
    list_grants_for_resources(db, {
      workspace_id,
      resource_type: 'connection',
      resource_ids: connections.map((connection) => connection.connection_id),
    }),
    list_grants_for_resources(db, {
      workspace_id,
      resource_type: 'project',
      resource_ids: projects.map((project) => project.project_id),
    }),
    list_workspace_api_keys(db, workspace_id),
  ]);
  const projects_of = read_projects_of_each_person(members, projects, project_grants);
  const default_access = read_resource_type_definition('connection').default_access;
  const name_of = read_memory_scope_name_lookup(members, api_keys);

  return {
    people: members.map((member) => ({
      user_id: member.user_id,
      name: format_person_name(member.first_name, member.last_name, member.email),
      email: member.email,
    })),
    projects: projects.map((project) => ({
      project_id: project.project_id,
      project_name: project.project_name,
    })),
    connections: read_connection_rows(connections, {
      members,
      connection_grants,
      projects_of,
      default_access,
    }),
    memory_scopes: await read_memory_scope_rows(db, workspace_id, {
      projects,
      members,
      project_grants,
      name_of,
    }),
  };
}

function read_connection_rows(
  connections: Awaited<ReturnType<typeof list_redacted_connections>>,
  input: {
    members: readonly Member[];
    connection_grants: ReadonlyMap<string, ResourceGrantRow[]>;
    projects_of: ReadonlyMap<string, string[]>;
    default_access: ReturnType<typeof read_resource_type_definition>['default_access'];
  },
) {
  return connections.map((connection) => ({
    connection_id: connection.connection_id,
    connection_name: connection.connection_name,
    app_display_name: connection.app?.app_display_name ?? null,
    app_icon_url:
      connection.app?.metadata.icon_url ?? connection.app?.display_config.icon_url ?? null,
    connected_by: connection.connected_by,
    cells: input.members.map((member) => ({
      user_id: member.user_id,
      ...where_a_person_can_use({
        default_access: input.default_access,
        grants: read_grant_rules(input.connection_grants.get(connection.connection_id)),
        person_user_id: member.user_id,
        owner_user_id: connection.connected_by,
        project_ids_the_person_is_in: input.projects_of.get(member.user_id) ?? [],
      }),
    })),
  }));
}

async function read_what_the_table_lists(db: Database, workspace_id: string) {
  const [connections, members, projects] = await Promise.all([
    list_redacted_connections(db, workspace_id),
    list_workspace_member_users(db, workspace_id),
    list_projects(db, { workspace_id, limit: most_projects_a_workspace_lists }),
  ]);
  return {
    connections: connections.filter(
      (connection) => !statuses_nobody_can_use.has(connection.connection_status),
    ),
    members,
    projects: projects.filter((project) => project.personal_for_user_id === null),
  };
}

function read_projects_of_each_person(
  members: readonly Member[],
  projects: readonly ProjectRow[],
  project_grants: ReadonlyMap<string, ResourceGrantRow[]>,
) {
  const projects_of = new Map<string, string[]>(members.map((member) => [member.user_id, []]));
  for (const project of projects) {
    const member_ids =
      project.project_access === 'workspace'
        ? members.map((member) => member.user_id)
        : (project_grants.get(project.project_id) ?? [])
            .filter((grant) => grant.grantee_type === 'user')
            .map((grant) => grant.grantee_id);
    for (const user_id of member_ids) projects_of.get(user_id)?.push(project.project_id);
  }
  return projects_of;
}

function read_grant_rules(grants: readonly ResourceGrantRow[] | undefined): GrantRule[] {
  return (grants ?? []).map((grant) => ({
    grantee_type: grant.grantee_type as GranteeType,
    grantee_id: grant.grantee_id,
    grant_level: grant.grant_level as GrantRule['grant_level'],
  }));
}
