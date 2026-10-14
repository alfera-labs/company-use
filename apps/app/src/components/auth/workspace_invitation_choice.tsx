import { format_error_message } from '@coworker/shared';
import { Button, buttonVariants } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Loader2, LogOut, Plus } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { BrandLogo } from '@/components/app/brand_logo';
import { useAuth } from '@/lib/auth_client';
import type { WorkspaceInvitation } from '@/lib/workos_workspace_api';
import { create_personal_workspace } from '@/lib/workspace_actions';

export function WorkspaceInvitationChoice({
  invitations,
  return_to,
}: {
  invitations: WorkspaceInvitation[];
  return_to: string;
}) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [is_creating, start_creating] = useTransition();
  const single_invitation = invitations.length === 1 ? invitations[0] : undefined;

  function take_own_workspace() {
    start_creating(async () => {
      try {
        await create_personal_workspace();
        navigate({ href: return_to, replace: true });
      } catch (error) {
        toast.error(format_error_message(error, 'Could not create your own workspace.'));
      }
    });
  }

  return (
    <div className="ob-root">
      <header className="ob-topbar">
        <span className="ob-brand">
          <BrandLogo className="ob-brand__logo" />
        </span>
        <div className="col-start-3 ob-topbar__right">
          <Button
            className="text-muted-foreground"
            onClick={() => void signOut({ returnTo: window.location.origin })}
            size="sm"
            type="button"
            variant="ghost"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Log out
          </Button>
        </div>
      </header>

      <main className="ob-stage">
        <div className="ob-step ob-step--center ob-animate">
          <div className="ob-head">
            <p className="ob-eyebrow">Invitation</p>
            <h1 className="ob-title">
              {single_invitation ? (
                <>
                  <span className="ob-accent">{single_invitation.organization_name}</span> invited
                  you
                </>
              ) : (
                'You have been invited'
              )}
            </h1>
            <p className="ob-subtitle">
              Join your team to share their chats, connected apps, and setup. Or start a workspace
              of your own.
            </p>
          </div>

          <div className="ob-actions">
            {invitations.map((invitation) => (
              <a
                className={cn(buttonVariants(), 'h-12 w-full text-[15px]')}
                href={invitation.accept_url}
                key={invitation.invitation_id}
              >
                {single_invitation ? 'Join workspace' : `Join ${invitation.organization_name}`}
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            ))}
            <Button
              className="h-12 w-full text-[15px]"
              disabled={is_creating}
              onClick={take_own_workspace}
              type="button"
              variant="outline"
            >
              {is_creating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Create my own workspace
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
