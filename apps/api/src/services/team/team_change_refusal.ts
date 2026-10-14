export const team_roles = ['owner', 'admin', 'member'] as const;
export type TeamRole = (typeof team_roles)[number];

/**
 * Why this person may not make this change to the team, or null when they may.
 *
 * An owner may change anyone. An admin may invite a member and remove a plain member, but
 * never touches an owner or another admin and never hands out the admin or the owner role. A sign-in
 * link signs its holder in as that person, so only an owner may make one for a person who has
 * already joined; an admin may make one for a person who has not joined yet.
 */
export function team_change_refusal(
  actor_role: string | null,
  change: { current_role?: string; next_role?: string; signs_in_as_a_joined_person?: boolean },
): string | null {
  if (actor_role === 'owner') return null;
  if (actor_role !== 'admin') return 'Managing the team needs an owner or an admin.';
  if (change.signs_in_as_a_joined_person) {
    return 'Only an owner can make a sign-in link for a person who has already joined.';
  }
  if (change.current_role !== undefined && change.current_role !== 'member') {
    return 'Only an owner can change an owner or an admin.';
  }
  if (change.next_role !== undefined && change.next_role !== 'member') {
    return 'Only an owner can make someone an admin or an owner.';
  }
  return null;
}
