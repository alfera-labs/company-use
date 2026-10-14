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
import { useRef } from 'react';

/** Asks before a chat is deleted. The focus starts on Cancel, so Enter keeps the chat. */
export function SidebarChatDeleteDialog({
  chat_title,
  open,
  on_open_change,
  on_delete,
}: {
  chat_title: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_delete: () => void;
}) {
  const cancel_button = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={on_open_change}>
      <AlertDialogContent initialFocus={cancel_button}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{chat_title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The chat and its messages leave your chat list. You cannot undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel_button}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={on_delete}>Delete chat</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
