import { resolve_workos_client } from '@api/lib/workos_client';

export type WorkosUserProfile = {
  email?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
};

export async function get_workos_user(workos_user_id: string): Promise<WorkosUserProfile | null> {
  const workos = resolve_workos_client();
  if (!workos) return null;
  const user = await workos.userManagement.getUser(workos_user_id);
  const email = user.email?.trim();
  const first_name = user.firstName?.trim();
  const last_name = user.lastName?.trim();
  const avatar_url = user.profilePictureUrl?.trim();
  return {
    ...(email ? { email } : {}),
    ...(first_name ? { first_name } : {}),
    ...(last_name ? { last_name } : {}),
    ...(avatar_url ? { avatar_url } : {}),
  };
}
