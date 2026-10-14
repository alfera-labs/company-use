export type ProjectBriefing = {
  project_name: string;
  project_description?: string | null;
  project_instructions?: string | null;
  member_names?: readonly string[];
};

export function format_project_briefing(
  project: ProjectBriefing,
  redact: (value: string | undefined) => string | undefined,
): string | null {
  const name = redact(project.project_name.trim());
  if (!name) return null;

  const description = redact(project.project_description?.trim() || undefined);
  const instructions = redact(project.project_instructions?.trim() || undefined);

  const members = (project.member_names ?? [])
    .map((member_name) => redact(member_name.trim()))
    .filter((member_name): member_name is string => Boolean(member_name));

  return [
    '## Project',
    '',
    `This chat is in the "${name}" project. If you are asked which project you are in, say so.`,
    ...(members.length
      ? ['', `People in this project (${members.length}): ${members.join(', ')}.`]
      : []),
    ...(description ? ['', `What belongs here: ${description}`] : []),
    ...(instructions ? ['', 'Rules for every chat in this project:', '', instructions] : []),
  ].join('\n');
}
