import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth_client';
import { is_local_user } from '@/lib/local_identity';

export function LogOutButton() {
  const { user, signOut } = useAuth();
  if (is_local_user(user)) return null;
  return (
    <button
      className="ob-quiet ob-logout"
      type="button"
      onClick={() => void signOut({ returnTo: window.location.origin })}
    >
      <LogOut className="size-4" aria-hidden="true" />
      Log out
    </button>
  );
}
