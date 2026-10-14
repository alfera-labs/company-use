export function format_trigger_display_name(raw_name: string, app_display_name = ''): string {
  const app_words = new Set(app_display_name.split(/\s+/u).filter(Boolean));
  return raw_name
    .trim()
    .replace(/\s+trigger$/iu, '')
    .replace(/\b[A-Z][a-z]+\b/gu, (word, offset: number) =>
      offset === 0 || app_words.has(word) ? word : word.toLowerCase(),
    );
}

export function format_trigger_display_name_without_app(
  display_name: string,
  app_display_name = '',
): string {
  const app = app_display_name.trim();
  const starts_with_app =
    app !== '' && display_name.toLowerCase().startsWith(`${app.toLowerCase()} `);
  if (!starts_with_app) return display_name;
  const rest = display_name.slice(app.length).trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
