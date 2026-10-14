import { z } from 'zod';

export const workspace_id_schema = z.string().min(1).max(128).brand<'WorkspaceId'>();
export type WorkspaceId = z.infer<typeof workspace_id_schema>;

export const scope_kind_name_schema = z
  .string()
  .regex(/^[a-z][a-z_]{1,30}$/u)
  .brand<'ScopeKindName'>();
export type ScopeKindName = z.infer<typeof scope_kind_name_schema>;

export const scope_key_schema = z
  .string()
  .regex(/^[a-z][a-z_]{1,30}(:[A-Za-z0-9._-]{1,128}){0,3}$/u)
  .brand<'ScopeKey'>();
export type ScopeKey = z.infer<typeof scope_key_schema>;

export const actor_key_schema = z
  .string()
  .regex(/^((user|guest|unlinked|key|agent):[A-Za-z0-9._:-]{1,200}|system)$/u)
  .brand<'ActorKey'>();
export type ActorKey = z.infer<typeof actor_key_schema>;
