import { AlertDialogCancel, AlertDialogFooter } from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Info, Loader2 } from 'lucide-react';
import type { CloseQuestion } from '@/components/app/use_close_question';

/**
 * The bottom of the scheduled task form: a note, the error of the last save, and Cancel and
 * Save. While the form asks whether to close with changes not saved, the two answers take the
 * place of Cancel and Save.
 */
export function ScheduledTaskDialogBottom({
  closing,
  shows_late_start_note,
  submit_error,
  can_submit,
  is_saving,
}: {
  closing: CloseQuestion;
  shows_late_start_note: boolean;
  submit_error: string | null;
  can_submit: boolean;
  is_saving: boolean;
}) {
  return (
    <>
      {shows_late_start_note ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          Runs may start a few minutes later to keep things running smoothly.
        </p>
      ) : null}
      {submit_error ? (
        <p className="text-xs text-destructive" role="alert">
          {submit_error}
        </p>
      ) : null}
      {closing.is_asking ? (
        <CloseQuestionRow on_close={closing.close} on_keep_editing={closing.keep_editing} />
      ) : (
        <AlertDialogFooter className="mt-0">
          <AlertDialogCancel type="button" disabled={is_saving}>
            Cancel
          </AlertDialogCancel>
          <Button type="submit" size="sm" disabled={!can_submit || is_saving}>
            {is_saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Save
          </Button>
        </AlertDialogFooter>
      )}
    </>
  );
}

function CloseQuestionRow({
  on_keep_editing,
  on_close,
}: {
  on_keep_editing: () => void;
  on_close: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <p className="text-sm" role="alert">
        Close without saving? Your changes are not kept.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={on_close}>
          Close without saving
        </Button>
        <Button autoFocus type="button" onClick={on_keep_editing}>
          Keep editing
        </Button>
      </div>
    </div>
  );
}
