import { assert_workspace_administrator } from '@coworker/core/access/assert_project_manager';
import type { GranteeType } from '@coworker/core/access/may_use_resource';
import {
  find_resource_type_definition,
  memory_scope_resource_type,
  read_resource_type_definition,
} from '@coworker/core/access/resource_types';
import type { Database } from '@coworker/core/db/connection';
import { find_memory_scope_item } from '@coworker/core/db/queries/memory_scope_items';
import {
  type GrantHolder,
  list_grants_for_resource,
} from '@coworker/core/db/queries/resource_grants';
import { find_unknown_parties } from '@coworker/core/db/queries/workspace_parties';
import { connections } from '@coworker/core/db/schema';
import { scope_key_schema } from '@coworker/memory/contracts/keys';
import { built_in_scope_kinds } from '@coworker/memory/contracts/scope_kinds';
import { scope_kind_of } from '@coworker/memory/scopes/scope_keys';
import { NotFoundError, ValidationError } from '@coworker/shared';
import { and, eq } from 'drizzle-orm';

export type AudienceResource = {
  resource_type: string;
  resource_id: string;
  connected_by: string | null;
};

const project_membership_is_not_editable_here =
  'A project membership is changed through /v1/projects/{project_id}/members, which advances its ' +
  'membership clock. This route does not.';

const memory_scope_members_are_owned_by_the_member_sync =
  'Memory scope members are owned by the member sync. Use the memory doors instead.';

export async function resolve_audience_resource(
  db: Database,
  input: { workspace_id: string; resource_type: string; resource_id: string },
): Promise<AudienceResource> {
  const base = { resource_type: input.resource_type, resource_id: input.resource_id };
  if (input.resource_type !== 'connection') return { ...base, connected_by: null };

  const [connection] = await db
    .select({ connected_by: connections.connected_by })
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.resource_id),
      ),
    )
    .limit(1);
  if (!connection) throw new NotFoundError('Connection');
  return { ...base, connected_by: connection.connected_by };
}

export async function read_resource_ref(
  db: Database,
  input: { workspace_id: string; resource_type: string; resource_id: string },
): Promise<AudienceResource> {
  if (!find_resource_type_definition(input.resource_type)) {
    throw new ValidationError(`Unknown resource_type "${input.resource_type}".`);
  }
  if (!input.resource_id) throw new ValidationError('resource_id is required');
  return resolve_audience_resource(db, input);
}

export function read_resource_grants(
  db: Database,
  input: { workspace_id: string; resource_type: string; resource_id: string },
) {
  return list_grants_for_resource(db, input);
}

export function refuse_memory_scope_write(resource_type: string): void {
  if (resource_type !== memory_scope_resource_type) return;
  throw new ValidationError(memory_scope_members_are_owned_by_the_member_sync);
}

const company_and_personal_memory_is_not_editable =
  'The company memory scope is open to every active workspace member, and a person scope is ' +
  'theirs alone. Neither has a reader list to edit.';

const project_memory_follows_project_membership =
  'A project memory scope has no reader list of its own: its readers are the project members. ' +
  'Add or remove it through /v1/projects/{project_id}/members.';

const known_scope_kinds = new Set(built_in_scope_kinds.map((kind) => kind.scope_kind));
const memory_grantee_types: readonly GranteeType[] = ['user', 'api_key'];

export function read_memory_scope_kind(scope_key: string): string {
  const parsed = scope_key_schema.safeParse(scope_key);
  if (!parsed.success) throw new NotFoundError('Memory scope');
  const kind = scope_kind_of(parsed.data);
  if (!known_scope_kinds.has(kind)) throw new NotFoundError('Memory scope');
  return kind;
}

async function assert_memory_scope_edit_allowed(
  db: Database,
  input: { workspace_id: string; resource_id: string },
): Promise<void> {
  const kind = read_memory_scope_kind(input.resource_id);
  if (kind === 'workspace' || kind === 'person') {
    throw new ValidationError(company_and_personal_memory_is_not_editable);
  }
  if (kind === 'project') throw new ValidationError(project_memory_follows_project_membership);
  const item = await find_memory_scope_item(db, {
    workspace_id: input.workspace_id,
    scope_key: input.resource_id,
  });
  if (!item) throw new NotFoundError('Memory scope');
}

function assert_memory_scope_grantee_type_allowed(grantee_type: string): void {
  if (memory_grantee_types.includes(grantee_type as GranteeType)) return;
  throw new ValidationError(
    `A memory scope reader is a person or an API key, not a "${grantee_type}".`,
  );
}

export async function assert_memory_scope_grantee_write_allowed(
  db: Database,
  input: { workspace_id: string; resource_type: string; resource_id: string; grantee_type: string },
): Promise<void> {
  if (input.resource_type !== memory_scope_resource_type) return;
  await assert_memory_scope_edit_allowed(db, input);
  assert_memory_scope_grantee_type_allowed(input.grantee_type);
}

export async function assert_audience_editor(
  db: Database,
  input: { workspace_id: string; user_id: string; resource: AudienceResource },
): Promise<void> {
  if (input.resource.resource_type === 'project') {
    throw new ValidationError(project_membership_is_not_editable_here);
  }
  if (input.resource.connected_by && input.resource.connected_by === input.user_id) return;
  await assert_workspace_administrator(db, {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
  });
}

export function assert_everyone_is_a_thing_this_can_be(
  resource_type: string,
  shared_with_everyone: boolean,
): void {
  const definition = read_resource_type_definition(resource_type);
  if (!shared_with_everyone || definition.default_access !== 'nobody') return;
  throw new ValidationError(
    `A ${definition.resource_label.toLowerCase()} cannot be shared with everyone. ` +
      'Name the people and coworkers who belong to it instead.',
  );
}

const party_words: Record<string, string> = {
  project: 'project',
  user: 'person',
  agent: 'coworker',
  api_key: 'API key',
};

export async function assert_parties_belong_to_workspace(
  db: Database,
  input: { workspace_id: string; parties: readonly GrantHolder[] },
): Promise<void> {
  const unknown = await find_unknown_parties(db, input);
  if (unknown.length === 0) return;
  const named = unknown
    .map(
      (party) => `${party_words[party.grantee_type] ?? party.grantee_type} "${party.grantee_id}"`,
    )
    .join(', ');
  throw new ValidationError(
    `This workspace has no active ${named}. Name only parties that are in this workspace.`,
  );
}
