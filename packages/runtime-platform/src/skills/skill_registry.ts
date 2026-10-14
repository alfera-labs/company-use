import { booking_a_table_skill } from '@runtime-platform/skills/library/booking_a_table';
import { booking_travel_skill } from '@runtime-platform/skills/library/booking_travel';
import { buying_online_skill } from '@runtime-platform/skills/library/buying_online';
import { calling_a_connected_app_skill } from '@runtime-platform/skills/library/calling_a_connected_app';
import { connecting_a_new_app_skill } from '@runtime-platform/skills/library/connecting_a_new_app';
import { document_files_skill } from '@runtime-platform/skills/library/document_files';
import { managing_connections_skill } from '@runtime-platform/skills/library/managing_connections';
import { operate_the_browser_skill } from '@runtime-platform/skills/library/operating_the_browser';
import { ordering_food_skill } from '@runtime-platform/skills/library/ordering_food';
import { pdf_files_skill } from '@runtime-platform/skills/library/pdf_files';
import { presentation_files_skill } from '@runtime-platform/skills/library/presentation_files';
import { recurring_job_as_a_script_skill } from '@runtime-platform/skills/library/recurring_job_as_a_script';
import { research_briefing_skill } from '@runtime-platform/skills/library/research_briefing';
import { scheduling_meetings_skill } from '@runtime-platform/skills/library/scheduling_meetings';
import { automation_skills } from '@runtime-platform/skills/library/setting_up_an_automation';
import { slack_channel_skill } from '@runtime-platform/skills/library/slack_channel';
import { spreadsheet_files_skill } from '@runtime-platform/skills/library/spreadsheet_files';
import type { SkillDefinition } from '@runtime-platform/skills/types';

const skill_definitions = [
  research_briefing_skill,
  operate_the_browser_skill,
  spreadsheet_files_skill,
  document_files_skill,
  pdf_files_skill,
  presentation_files_skill,
  slack_channel_skill,
  calling_a_connected_app_skill,
  connecting_a_new_app_skill,
  managing_connections_skill,
  recurring_job_as_a_script_skill,
  ...automation_skills,
  booking_a_table_skill,
  booking_travel_skill,
  buying_online_skill,
  ordering_food_skill,
  scheduling_meetings_skill,
] satisfies SkillDefinition[];

const skill_map = new Map(skill_definitions.map((skill) => [skill.skill_slug, skill]));

if (skill_map.size !== skill_definitions.length) {
  throw new Error('skill_registry has duplicate skill_slug values');
}

export function get_all_skills() {
  return [...skill_definitions];
}

export function find_skill_by_slug(skill_slug: string) {
  return skill_map.get(skill_slug) ?? null;
}
