import { create_app } from '@api/app';
import { proxy_auth_headers } from '@api/lib/proxy_identity';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import type { ConnectionConfigData } from '@coworker/core/db/schema/json_column_types';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

const proxy_secret = 'local-development-internal-api-secret';

export type Person = {
  name: string;
  email: string;
  headers: Record<string, string>;
  user_id: string;
};

export type ApiApp = { request: (path: string, init?: RequestInit) => Promise<Response> };

export function identity_headers(input: { user: string; email: string; organization: string }) {
  return {
    'Content-Type': 'application/json',
    [proxy_auth_headers.secret]: proxy_secret,
    [proxy_auth_headers.provider_key]: 'workos',
    [proxy_auth_headers.provider_user_id]: input.user,
    [proxy_auth_headers.organization_id]: input.organization,
    [proxy_auth_headers.email]: input.email,
    [proxy_auth_headers.first_name]: input.user,
    [proxy_auth_headers.last_name]: 'Tester',
  };
}

export function request_json(
  app: ApiApp,
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function read_data(
  app: ApiApp,
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await request_json(app, headers, method, path, body);
  if (response.status >= 400) {
    throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return (await response.json()).data;
}

export async function create_api(): Promise<{ db: Database; app: ApiApp }> {
  const db = await create_test_database();
  return { db, app: create_app(db) as ApiApp };
}

export async function sign_in(
  app: ApiApp,
  input: { name: string; email: string; organization: string },
): Promise<Person> {
  const headers = identity_headers({
    user: input.name,
    email: input.email,
    organization: input.organization,
  });
  const workspace = await read_data(app, headers, 'GET', '/v1/workspace');
  const members = await read_data(app, headers, 'GET', '/v1/workspace/members');
  const me = members.members.find((member: { email: string }) => member.email === input.email);
  if (!me) throw new Error(`${input.email} did not appear in ${workspace.workspace_id}`);
  return { name: input.name, email: input.email, headers, user_id: me.user_id };
}

export async function create_room(app: ApiApp, admin: Person, project_name: string) {
  const project = await read_data(app, admin.headers, 'POST', '/v1/projects', { project_name });
  return project.project_id as string;
}

export async function add_to_room(app: ApiApp, admin: Person, project_id: string, member: Person) {
  await read_data(app, admin.headers, 'PUT', `/v1/projects/${project_id}/members`, {
    grantee_type: 'user',
    grantee_id: member.user_id,
    grant_level: 'use',
  });
}

export async function create_catalog_app(db: Database, app_name: string) {
  const seeded = await db.query.apps.findFirst({
    where: and(eq(apps.app_name, app_name), eq(apps.catalog_scope, 'global')),
  });
  if (seeded) return seeded.app_id;

  const app_id = create_id(id_prefixes.app);
  await db.insert(apps).values({
    app_id,
    app_name,
    app_key: app_name,
    catalog_scope: 'global',
    app_display_name: app_name,
    app_category: 'productivity',
    auth_type: 'oauth2',
    app_status: 'active',
    display_config: {},
    metadata: {},
    created_by: 'system:eval',
    last_updated_by: 'system:eval',
  });
  return app_id;
}

export async function create_connection(
  db: Database,
  input: {
    workspace_id: string;
    app_id: string;
    connection_id: string;
    connection_name: string;
    connected_by: string;
    connection_config?: ConnectionConfigData;
  },
) {
  await db.insert(connections).values({
    connection_id: input.connection_id,
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    connection_key: `native:${input.connection_id}`,
    connection_name: input.connection_name,
    connection_status: 'active',
    provider_key: 'native',
    provider_config_key: `native:${input.app_id}`,
    provider_config_version: 1,
    connection_profile_key: `native:${input.app_id}:oauth2`,
    connection_profile_version: 1,
    auth_method_key: 'oauth2_authorization_code',
    external_account_id: input.connection_id,
    authorized_scopes: [],
    health_status: 'healthy',
    connection_config: input.connection_config ?? {},
    connected_by: input.connected_by,
    metadata: {},
    created_by: input.connected_by,
    last_updated_by: input.connected_by,
  });
  return input.connection_id;
}

export async function create_catalog_node(
  db: Database,
  input: { app_id: string; app_name: string; node_name: string },
) {
  const node_key = `${input.app_name}-${input.node_name}-1`;
  await db.insert(nodes).values({
    node_id: create_id(id_prefixes.node),
    app_id: input.app_id,
    app_key: input.app_name,
    node_name: input.node_name,
    catalog_scope: 'global',
    node_key,
    node_version: 1,
    node_display_name: input.node_name,
    node_kind: 'tool',
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object', properties: {} },
    runtime_handler: `${input.app_name}.${input.node_name}`,
    node_runtime: 'native_tool',
    node_status: 'active',
    discovery_status: 'visible',
    provider_key: 'native',
    provider_config_key: `native:${input.app_id}`,
    provider_config_version: 1,
    connection_profile_key: `native:${input.app_id}:oauth2`,
    connection_profile_version: 1,
    node_config: {},
    created_by: 'system:eval',
    last_updated_by: 'system:eval',
  });
  return node_key;
}

export type SharingGrantee =
  | { project: string; can: 'use' | 'manage' }
  | { person: string; can: 'use' | 'manage' }
  | { coworker: string; can: 'use' | 'manage' };

export type ResourceSharing = {
  resource_type: string;
  shared_with_everyone_in_the_workspace: boolean;
  shared_with: SharingGrantee[];
};

export function project_ids_in(sharing: ResourceSharing): string[] {
  return sharing.shared_with.flatMap((entry) => ('project' in entry ? [entry.project] : []));
}

export function share_with_projects(project_ids: readonly string[]) {
  return {
    shared_with_everyone_in_the_workspace: false,
    shared_with: project_ids.map((project_id) => ({ project: project_id, can: 'use' as const })),
  };
}

export function share_with_everyone() {
  return { shared_with_everyone_in_the_workspace: true, shared_with: [] };
}
