import type { Database } from '@coworker/core';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { find_agent_by_slug } from '@coworker/core/db/queries/sessions';
import { NotFoundError } from '@coworker/shared';
import { read_workspace_skill_index } from '@runtime-platform/skills/read_workspace_skill_index';
import { get_all_skills } from '@runtime-platform/skills/skill_registry';

export type PublicSkill = {
  skill_id: string;
  name: string;
  description: string;
  source: 'platform' | 'workspace';
};

const default_agent_slug = 'main';

export async function list_api_skills(
  db: Database,
  api_key: ApiKey,
  agent_slug: string | undefined,
): Promise<PublicSkill[]> {
  const agent = await find_agent_by_slug(
    db,
    api_key.workspace_id,
    agent_slug ?? default_agent_slug,
  );
  if (!agent) throw new NotFoundError('Agent');
  const platform_skills = get_all_skills().map(
    (skill): PublicSkill => ({
      skill_id: skill.skill_slug,
      name: skill.skill_name,
      description: skill.description,
      source: 'platform',
    }),
  );
  const index = await read_workspace_skill_index(db, {
    workspace_id: api_key.workspace_id,
    agent_id: agent.agent_id,
  });
  const platform_ids = new Set(platform_skills.map((skill) => skill.skill_id));
  const workspace_skills = index.entries
    .filter((entry) => !platform_ids.has(entry.skill_slug))
    .map(
      (entry): PublicSkill => ({
        skill_id: entry.skill_slug,
        name: entry.skill_name,
        description: entry.skill_hint,
        source: 'workspace',
      }),
    );
  return [...platform_skills, ...workspace_skills];
}

export async function get_api_skill(
  db: Database,
  api_key: ApiKey,
  input: { skill_id: string; agent_slug: string | undefined },
): Promise<PublicSkill> {
  const skills = await list_api_skills(db, api_key, input.agent_slug);
  const skill = skills.find((candidate) => candidate.skill_id === input.skill_id);
  if (!skill) throw new NotFoundError('Skill');
  return skill;
}
