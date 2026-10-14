import { format_error_message } from '@coworker/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { sign_out_everywhere } from '@/lib/api/team_mode';

/** Ends every session of this person. It asks first: coming back takes a new sign-in link. */
export function TeamModeSignOutEverywhere() {
  const [is_asking, set_is_asking] = useState(false);
  const sign_out = useMutation({
    mutationFn: sign_out_everywhere,
    onSuccess: () => window.location.assign('/'),
    onError: (error) => toast.error(format_error_message(error, 'Could not sign you out')),
  });

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={sign_out.isPending}
        onClick={() => set_is_asking(true)}
      >
        Sign out everywhere
      </Button>
      <AlertDialog open={is_asking} onOpenChange={set_is_asking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends every session of yours, this one too. To come back you need a new sign-in
              link: ask an owner or an admin of the workspace, or run ./alfera team link on the
              machine that runs Alfera.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => sign_out.mutate()}>
              Sign out everywhere
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
