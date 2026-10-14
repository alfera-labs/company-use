const inline_flags_at_start = /^\(\?([ims]+)\)/u;

/**
 * Models write search patterns for ripgrep, which takes its flags inline, as in `(?i)name`.
 * JavaScript refuses that form, so the flags move to the expression's own flags.
 */
export function search_expression(pattern: string, case_sensitive: boolean | undefined): RegExp {
  const inline_flags = inline_flags_at_start.exec(pattern);
  const source = inline_flags ? pattern.slice(inline_flags[0].length) : pattern;
  const flags = new Set(inline_flags?.[1] ?? '');
  if (case_sensitive === false) flags.add('i');
  return new RegExp(source, [...flags].join(''));
}
