import type { HarnessSkill } from '@agent-core/harness/types';

export function format_skill_invocation(skill: HarnessSkill, additional_instructions?: string) {
  const skill_block = [
    `<skill name="${escape_xml(skill.name)}" location="${escape_xml(skill.file_path)}">`,
    `References are relative to ${skill_directory(skill.file_path)}.`,
    '',
    skill.content,
    '</skill>',
  ].join('\n');

  return additional_instructions ? `${skill_block}\n\n${additional_instructions}` : skill_block;
}

const default_skill_load_instructions = [
  'Read the full skill file when the task matches its hint.',
  'Resolve relative references against the skill file directory.',
].join('\n');

const skill_hint_budget_chars = 180;

export function format_skills_for_system_prompt(
  skills: readonly HarnessSkill[],
  load_instructions: string = default_skill_load_instructions,
) {
  const visible_skills = skills.filter((skill) => !skill.disable_model_invocation);
  if (visible_skills.length === 0) return '';

  return [
    'Skills are packaged instructions, indexed below by name with a shortened description.',
    load_instructions,
    'A hint is a summary, not the full trigger list — load a skill whenever a task is plausibly in scope.',
    '',
    '<available_skills>',
    ...group_skills_by_directory(visible_skills).flatMap(skill_group_lines),
    '</available_skills>',
  ].join('\n');
}

type SkillDirectoryGroup = { directory: string; skills: HarnessSkill[] };

/**
 * The skills of one directory, printed with that directory named once instead of repeated
 * on every entry. Groups come out sorted by directory and skills sorted by name.
 *
 * The sort is a correctness requirement, not tidiness. Anthropic matches a cached prompt
 * prefix byte for byte from position 0, so one reordered line re-bills the whole system
 * prompt at cache-write price. Callers hand us whatever order their source happened to
 * produce — a literal array today, database rows once skills are stored per workspace, and
 * rows come back in no guaranteed order — so this block orders itself rather than trusting
 * the caller or the insertion order of the Map below.
 *
 * Ordering compares with < and > rather than localeCompare: collation depends on the
 * runtime's locale and ICU build, which is not a byte-stable contract across machines.
 */
function group_skills_by_directory(skills: readonly HarnessSkill[]): SkillDirectoryGroup[] {
  const groups = new Map<string, HarnessSkill[]>();
  for (const skill of skills) {
    const directory = skill_directory(skill.file_path);
    const group = groups.get(directory);
    if (group) group.push(skill);
    else groups.set(directory, [skill]);
  }

  return [...groups]
    .map(([directory, group_skills]) => ({
      directory,
      skills: [...group_skills].sort(compare_skills_by_name_then_path),
    }))
    .sort((left, right) => compare_strings(left.directory, right.directory));
}

function compare_skills_by_name_then_path(left: HarnessSkill, right: HarnessSkill) {
  return compare_strings(left.name, right.name) || compare_strings(left.file_path, right.file_path);
}

function compare_strings(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function skill_group_lines(group: SkillDirectoryGroup) {
  return [
    `  <skills root="${escape_xml(group.directory)}">`,
    ...group.skills.map(skill_index_line),
    '  </skills>',
  ];
}

function skill_index_line(skill: HarnessSkill) {
  return `    ${escape_angle_brackets(skill.name)}${skill_file_name_suffix(skill)}: ${short_skill_hint(skill.discovery_hint ?? skill.description)}`;
}

function skill_file_name_suffix(skill: HarnessSkill) {
  const file_name = skill.file_path.replace(/\/+$/, '').split('/').pop() ?? '';
  return file_name === skill.name ? '' : ` (${escape_angle_brackets(file_name)})`;
}

function short_skill_hint(description: string) {
  const single_line = description.replace(/\s+/g, ' ').trim();

  let hint = '';
  for (const sentence of split_into_sentences(single_line)) {
    const next = hint ? `${hint} ${sentence}` : sentence;
    if (next.length > skill_hint_budget_chars) break;
    hint = next;
  }
  if (hint) return escape_angle_brackets(hint);

  const cut = single_line.slice(0, skill_hint_budget_chars);
  const last_space = cut.lastIndexOf(' ');
  const trimmed = (last_space === -1 ? cut : cut.slice(0, last_space)).trimEnd();
  return `${escape_angle_brackets(trimmed)}…`;
}

function split_into_sentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+(?=["'(\p{Lu}])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function skill_directory(file_path: string) {
  const normalized = file_path.replace(/\/+$/, '');
  const slash_index = normalized.lastIndexOf('/');
  return slash_index === -1 ? '.' : normalized.slice(0, slash_index);
}

function escape_angle_brackets(value: string) {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escape_xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
