const generic_attribution_line = 'Sent by an AI agent on Alfera.';
const attribution_line_ending = ' AI agent on Alfera.';
const attribution_separator = '\n\n— ';
const workspace_name_filler_words = new Set(['workspace', 'workspaces', 'team', 'org', 'inc']);

export function email_attribution_line(workspace_name: string | undefined): string {
  const name = drop_filler_words(workspace_name ?? '');
  if (!name) return generic_attribution_line;
  return `Sent by ${possessive(name)} AI agent on Alfera.`;
}

export function append_email_attribution(
  text: string,
  attribution_enabled: boolean,
  workspace_name?: string,
): string {
  if (!attribution_enabled) return text;
  if (text.includes(attribution_line_ending)) return text;
  return `${text.trimEnd()}${attribution_separator}${email_attribution_line(workspace_name)}`;
}

function possessive(name: string): string {
  if (name.endsWith("'s") || name.endsWith("s'")) return name;
  if (name.endsWith('s')) return `${name}'`;
  return `${name}'s`;
}

function drop_filler_words(workspace_name: string): string {
  const words = workspace_name.trim().split(/\s+/u);
  while (words.length > 1) {
    const last =
      words
        .at(-1)
        ?.toLowerCase()
        .replace(/[^a-z]/gu, '') ?? '';
    if (!workspace_name_filler_words.has(last)) break;
    words.pop();
  }
  return words.join(' ');
}
