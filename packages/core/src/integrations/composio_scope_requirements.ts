import { z } from 'zod';

/**
 * What a Composio tool needs from a connection: one scope, a group whose every member must hold
 * (`all_of`), or a group where any one member is enough (`any_of`). Groups nest, so an `any_of`
 * alternative can itself need several scopes. Extra keys such as `source` are kept.
 */
export type ComposioScopeRequirement =
  | string
  | { all_of: ComposioScopeRequirement[] }
  | { any_of: ComposioScopeRequirement[] };

const scope_requirement_schema: z.ZodType<ComposioScopeRequirement> = z.lazy(() =>
  z.union([z.string(), scope_requirement_all_of_schema, scope_requirement_any_of_schema]),
);

const scope_requirement_all_of_schema = z
  .object({ all_of: z.array(scope_requirement_schema) })
  .passthrough();

const scope_requirement_any_of_schema = z
  .object({ any_of: z.array(scope_requirement_schema) })
  .passthrough();

/** The `scope_requirements` field of a Composio tool: an `all_of` group at the top. */
export const composio_scope_requirements_schema = scope_requirement_all_of_schema;

/**
 * The scopes a connection must hold whichever way it satisfies the requirement: every member of an
 * `all_of` group, and only the scopes that every `any_of` alternative shares. The compatibility
 * gate demands this list in full, so a scope that one alternative can skip never lands in it.
 */
export function scopes_every_way_needs(requirement: ComposioScopeRequirement): string[] {
  if (typeof requirement === 'string') return [requirement];
  if ('all_of' in requirement) {
    return [...new Set(requirement.all_of.flatMap(scopes_every_way_needs))];
  }
  const [first = [], ...others] = requirement.any_of.map(scopes_every_way_needs);
  return first.filter((scope) => others.every((alternative) => alternative.includes(scope)));
}
