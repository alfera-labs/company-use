export function user_initials(
  first_name: string | null | undefined,
  last_name: string | null | undefined,
  email: string | null | undefined,
) {
  const letters = `${first_name?.[0] ?? ''}${last_name?.[0] ?? ''}`.trim();
  if (letters) return letters.toUpperCase();
  return (email?.[0] ?? 'U').toUpperCase();
}
