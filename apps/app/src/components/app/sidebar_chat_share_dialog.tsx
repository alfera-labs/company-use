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

/**
 * Asks before a chat moves into a project other people read. The focus starts on Cancel, so
 * Enter shares nothing.
 */
export function SidebarChatShareDialog({
  chat_title,
  readers,
  open,
  on_open_change,
  on_share,
}: {
  chat_title: string;
  readers: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_share: () => void;
}) {
  const cancel_button = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={on_open_change}>
      <AlertDialogContent initialFocus={cancel_button}>
        <AlertDialogHeader>
          <AlertDialogTitle>Share “{chat_title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {readers} will be able to read this chat. Move it back to Personal to make it private
            again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel_button}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={on_share}>Share the chat</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
