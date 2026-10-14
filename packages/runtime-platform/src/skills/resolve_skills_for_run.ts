import { format_skills_for_system_prompt } from '@agent-core/harness/resources';
import type { HarnessSkill } from '@agent-core/harness/types';
import { to_harness_skill } from '@runtime-platform/skills/map_skill_to_harness_skill';
import type { SkillIndex } from '@runtime-platform/skills/skill_index_artifact';
import { get_all_skills } from '@runtime-platform/skills/skill_registry';
import type { SkillDefinition } from '@runtime-platform/skills/types';

const load_skill_instructions =
  'Call the runtime-load_skill-1 tool with the skill name to load its full instructions ' +
  'when a task matches its hint.';

function is_skill_offered_on_source(
  available_on_source_types: readonly string[] | null | undefined,
  source_type: string | undefined,
) {
  if (!available_on_source_types) return true;
  return source_type !== undefined && available_on_source_types.includes(source_type);
}

function is_platform_skill_offered(skill: SkillDefinition, source_type: string | undefined) {
  return is_skill_offered_on_source(skill.available_on_source_types, source_type);
}

export type ResolveSkillsInput = {
  source_type?: string;
  workspace_skill_index?: SkillIndex;
};

/**
 * The skills discoverable on a run: the platform's own, plus the workspace's procedures.
 *
 * The PLATFORM wins a slug collision. A workspace procedure is written by the agent itself,
 * from material that may have come off a web page or an inbound email, so letting it take a
 * platform slug would let injected content replace a platform protocol — including one the
 * platform marked disable_model_invocation. Its own work still gets a home; it just cannot
 * take a name we already use.
 */
export function resolve_skills_for_run(input: ResolveSkillsInput = {}): HarnessSkill[] {
  const platform_skills = get_all_skills();
  const platform_slugs = new Set(platform_skills.map((skill) => skill.skill_slug));
  const workspace_skills = (input.workspace_skill_index?.entries ?? [])
    .filter((entry) => !platform_slugs.has(entry.skill_slug))
    .filter((entry) =>
      is_skill_offered_on_source(entry.available_on_source_types, input.source_type),
    )
    .map(
      (entry): HarnessSkill => ({
        name: entry.skill_slug,
        description: entry.skill_hint,
        content: '',
        file_path: `${entry.body_path}`,
      }),
    );
  const offered_platform_skills = platform_skills
    .filter((skill) => is_platform_skill_offered(skill, input.source_type))
    .map(to_harness_skill);

  return [...offered_platform_skills, ...workspace_skills];
}

/** The `<available_skills>` discovery block for the system prompt, or '' when there are none. */
export function build_skills_discovery_block(input: ResolveSkillsInput = {}): string {
  return format_skills_for_system_prompt(resolve_skills_for_run(input), load_skill_instructions);
}
