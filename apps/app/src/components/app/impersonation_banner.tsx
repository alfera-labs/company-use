import { Button } from '@coworker/ui/components/button';
import { UserCog } from 'lucide-react';
import { useAuth } from '@/lib/auth_client';

// Persistent bar shown while an admin is impersonating another user (WorkOS dashboard impersonation).
// It sits at the top of the content pane so it's always visible, names who is being viewed and who
// started it, and offers a one-click exit. "Stop" signs out, which ends the impersonation session on
// WorkOS's side and returns the admin to a normal sign-in.
export function ImpersonationBanner({
  impersonator_email,
  subject_email,
  reason,
}: {
  impersonator_email: string;
  subject_email?: string | undefined;
  reason?: string | undefined;
}) {
  const { signOut } = useAuth();

  return (
    <div
      role="status"
      className="sticky top-0 z-sticky flex items-center gap-3 border-b border-caution/40 bg-caution-wash px-4 py-2 text-sm text-caution-ink"
    >
      <UserCog className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 truncate">
        Viewing as <span className="font-medium">{subject_email ?? 'this user'}</span>
        <span className="text-caution-ink/70">
          {' '}
          — impersonated by {impersonator_email}
          {reason ? ` (${reason})` : ''}
        </span>
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 border-caution/50 bg-transparent hover:bg-caution/20"
        onClick={() => void signOut({ returnTo: window.location.origin })}
      >
        Stop impersonating
      </Button>
    </div>
  );
}
