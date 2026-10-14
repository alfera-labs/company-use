export const imported_persona_start = '<!-- imported-persona:start -->';
export const imported_persona_end = '<!-- imported-persona:end -->';

const imported_persona_pattern = new RegExp(
  `${imported_persona_start}[\\s\\S]*?(?:${imported_persona_end}|$)`,
  'g',
);

export function remove_imported_persona_section(system_prompt: string): string {
  return system_prompt.replace(imported_persona_pattern, '').trim();
}
