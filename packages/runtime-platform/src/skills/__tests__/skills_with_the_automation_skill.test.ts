import { get_all_skills } from '@runtime-platform/skills/skill_registry';
import { describe, expect, it } from 'vitest';

describe('the skill registry with the automation skill', () => {
  it('offers the automation skill', () => {
    const slugs = get_all_skills().map((skill) => skill.skill_slug);
    expect(slugs).toEqual(expect.arrayContaining(['setting-up-an-automation']));
  });
});
