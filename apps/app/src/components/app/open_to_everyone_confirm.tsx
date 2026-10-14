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

export function OpenToEveryoneConfirm({
  open,
  workspace_name,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  workspace_name?: string | undefined;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {workspace_name ? `Open to everyone at ${workspace_name}?` : 'Open to everyone?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Anyone in the workspace will be able to use it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={onConfirm}>
            Open to everyone
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
