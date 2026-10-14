import type { GranteeType } from '@coworker/core/access/may_use_resource';
import { read_resource_type_definition } from '@coworker/core/access/resource_types';
import type { ResourceGrantRow, SharingEntry } from '@coworker/core/db/queries/resource_grants';
import { z } from 'zod';

const grant_level_schema = z.enum(['use', 'manage']);

export const sharing_entry_schema = z.union([
  z.object({ project: z.string().min(1), can: grant_level_schema.default('use') }).strict(),
  z.object({ person: z.string().min(1), can: grant_level_schema.default('use') }).strict(),
  z.object({ coworker: z.string().min(1), can: grant_level_schema.default('use') }).strict(),
  z.object({ api_key: z.string().min(1), can: grant_level_schema.default('use') }).strict(),
]);

export const set_sharing_body_schema = z
  .object({
    shared_with_everyone_in_the_workspace: z.boolean(),
    shared_with: z.array(sharing_entry_schema).default([]),
    replaces: z.array(sharing_entry_schema).optional(),
  })
  .strict()
  .refine(
    (body) => !(body.shared_with_everyone_in_the_workspace && body.shared_with.length > 0),
    'shared_with must be empty when shared_with_everyone_in_the_workspace is true',
  )
  .refine(
    (body) => body.shared_with_everyone_in_the_workspace || body.shared_with.length > 0,
    'shared_with must name at least one party when the resource is not shared with everyone',
  );

export type SetSharingBody = z.infer<typeof set_sharing_body_schema>;
export type SharingEntryBody = z.infer<typeof sharing_entry_schema>;

export function read_sharing_entries(body: SetSharingBody): SharingEntry[] {
  if (body.shared_with_everyone_in_the_workspace) return [];
  return body.shared_with.map(read_sharing_entry);
}

export function read_replaced_entries(body: SetSharingBody): SharingEntry[] | undefined {
  return body.replaces?.map(read_sharing_entry);
}

export function read_sharing_entry(entry: SharingEntryBody): SharingEntry {
  if ('project' in entry) {
    return { grantee_type: 'project', grantee_id: entry.project, grant_level: entry.can };
  }
  if ('person' in entry) {
    return { grantee_type: 'user', grantee_id: entry.person, grant_level: entry.can };
  }
  if ('api_key' in entry) {
    return { grantee_type: 'api_key', grantee_id: entry.api_key, grant_level: entry.can };
  }
  return { grantee_type: 'agent', grantee_id: entry.coworker, grant_level: entry.can };
}

const sharing_entry_key_of_grantee_type: Record<string, string> = {
  project: 'project',
  user: 'person',
  api_key: 'api_key',
  agent: 'coworker',
};

export function format_sharing_entry(entry: SharingEntry): Record<string, string> {
  const key = sharing_entry_key_of_grantee_type[entry.grantee_type] ?? 'coworker';
  return { [key]: entry.grantee_id, can: entry.grant_level };
}

export function format_sharing_response(
  resource_type: string,
  grants: readonly ResourceGrantRow[],
) {
  const definition = read_resource_type_definition(resource_type);
  return {
    resource_type,
    shared_with_everyone_in_the_workspace:
      grants.length === 0 && definition.default_access === 'everyone_in_the_workspace',
    shared_with: grants.map((grant) =>
      format_sharing_entry({
        grantee_type: grant.grantee_type as GranteeType,
        grantee_id: grant.grantee_id,
        grant_level: grant.grant_level as 'use' | 'manage',
      }),
    ),
  };
}
