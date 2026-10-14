// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { use_schedule_live_switch } from '@/components/app/automations/scheduled_task_rows';
import type { UpdateScheduledTaskInput } from '@/components/app/scheduled_task_create_dialog';
import { delete_trigger, run_trigger, type Trigger, update_trigger } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { create_random_id } from '@/lib/random_id';

export function use_scheduled_automation_actions(task: Trigger) {
  const navigate = useNavigate();
  const query_client = useQueryClient();
  const refresh = () => query_client.invalidateQueries({ queryKey: query_keys.triggers() });
  const update = useMutation({
    mutationFn: (input: UpdateScheduledTaskInput) => update_trigger(task.trigger_id, input),
    onSuccess: async () => {
      toast.success('Saved');
      await refresh();
    },
    onError: complain('Could not save the automation'),
  });
  const live_switch = use_schedule_live_switch();
  const set_live = {
    isPending: live_switch.isPending,
    mutate: (live: boolean) => live_switch.mutate({ trigger_id: task.trigger_id, live }),
  };
  const run_now = useMutation({
    mutationFn: () => run_trigger(task.trigger_id, create_random_id()),
    onSuccess: async () => {
      toast.success('Started');
      await query_client.invalidateQueries({ queryKey: query_keys.trigger_runs(task.trigger_id) });
    },
    onError: complain('Could not start the automation'),
  });
  const remove = useMutation({
    mutationFn: () => delete_trigger(task.trigger_id),
    onSuccess: async () => {
      await refresh();
      toast.success('Deleted');
      navigate({ to: '/automations' });
    },
    onError: complain('Could not delete the automation'),
  });
  return { update, set_live, run_now, remove };
}

export function DeleteScheduledAutomation({
  task,
  onDelete,
}: {
  task: Trigger;
  onDelete: () => void;
}) {
  const [open, set_open] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button aria-label="More" size="icon-sm" type="button" variant="ghost">
              <Ellipsis className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={() => set_open(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={open} onOpenChange={set_open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {task.trigger_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops running and is removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={onDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function complain(fallback: string) {
  return (error: unknown) => toast.error(format_error_message(error, fallback));
}
