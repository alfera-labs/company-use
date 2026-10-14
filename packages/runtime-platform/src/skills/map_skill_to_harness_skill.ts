import type { HarnessSkill } from '@agent-core/harness/types';
import type { SkillDefinition } from '@runtime-platform/skills/types';

const global_skill_location_scheme = 'skill://global';

/**
 * Maps a code-defined skill onto the harness skill primitive that the
 * `agent-core` formatters consume for discovery and invocation.
 *
 * The skill slug is used as the harness `name` because that is the identifier
 * the model passes to the `runtime-load_skill-1` tool. `file_path` is a virtual
 * locator (skill://global/<slug>) since built-in skills have no filesystem home.
 */
export function to_harness_skill(skill: SkillDefinition): HarnessSkill {
  return {
    name: skill.skill_slug,
    description: skill.description,
    ...(skill.discovery_hint === undefined ? {} : { discovery_hint: skill.discovery_hint }),
    content: skill.body,
    file_path: `${global_skill_location_scheme}/${skill.skill_slug}`,
    ...(skill.disable_model_invocation === undefined
      ? {}
      : { disable_model_invocation: skill.disable_model_invocation }),
  };
}
