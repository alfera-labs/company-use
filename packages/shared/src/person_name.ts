export function format_person_name(
  first_name: string | null | undefined,
  last_name: string | null | undefined,
  fallback = '',
): string {
  return [first_name, last_name].filter(Boolean).join(' ') || fallback;
}
