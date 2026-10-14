/**
 * A skill declared in code. This is the authoring shape for built-in skills.
 *
 * When skills later move to a `skills` table, one row maps onto this same shape,
 * so nothing downstream of the registry (resolution, discovery, loading) changes.
 */
export type SkillDefinition = {
  skill_slug: string;
  skill_name: string;
  description: string;
  discovery_hint?: string;
  body: string;
  disable_model_invocation?: boolean;
  available_on_source_types?: string[];
};
