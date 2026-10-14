import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { useRef, useState } from 'react';

export function useDiscardChanges() {
  const [message, set_message] = useState<string | null>(null);
  const resolve = useRef<((discard: boolean) => void) | null>(null);
  const answer = (discard: boolean) => {
    resolve.current?.(discard);
    resolve.current = null;
    set_message(null);
  };
  const confirm_discard = (question: string): Promise<boolean> => {
    // Native modal dialogs sit above portals. Keep the confirmation in that top layer.
    if (document.querySelector('dialog:modal')) return Promise.resolve(window.confirm(question));
    return new Promise((complete) => {
      resolve.current = complete;
      set_message(question);
    });
  };
  const discard_dialog = (
    <AlertDialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{message}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>Keep editing</AlertDialogCancel>
          <Button variant="destructive" onClick={() => answer(true)}>
            Discard changes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm_discard, discard_dialog };
}
