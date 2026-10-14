/** The one person a local-mode install serves. Local mode has no sign-in, so no sign-out. */
export const local_user_id = 'user_local';

export function is_local_user(user: { id: string } | null | undefined) {
  return user?.id === local_user_id;
}
