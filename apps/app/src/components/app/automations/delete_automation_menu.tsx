// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
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
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type AutomationTrigger,
  delete_automation,
  type TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import { find_trigger_type } from '@/components/app/automations/trigger_types_model';
import { query_keys } from '@/lib/api/query_keys';

export function DeleteAutomationMenu({
  automationId,
  automationName,
  triggers,
  catalog,
}: {
  automationId: string;
  automationName: string;
  triggers: AutomationTrigger[];
  catalog: TriggerTypeCatalog | undefined;
}) {
  const [asking, set_asking] = useState(false);
  const remove = use_delete_automation(automationId, triggers, catalog);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button aria-label="More" size="icon-sm" type="button" variant="ghost">
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={remove.isPending} onClick={() => set_asking(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={asking} onOpenChange={set_asking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {automationName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its triggers stop and it will not run again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => remove.mutate()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function use_delete_automation(
  automation_id: string,
  triggers: AutomationTrigger[],
  catalog: TriggerTypeCatalog | undefined,
) {
  const query_client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => delete_automation(automation_id),
    onSuccess: async (answer) => {
      await query_client.invalidateQueries({ queryKey: query_keys.automations() });
      const kept = answer.triggers.filter((removal) => !removal.removed);
      if (kept.length === 0) return navigate({ to: '/automations' });
      for (const removal of kept) {
        const app = app_name_of(removal.trigger_id, triggers, catalog);
        toast.error(`Could not disconnect ${app}; it may still send events.`);
      }
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not delete the automation')),
  });
}

function app_name_of(
  trigger_id: string,
  triggers: AutomationTrigger[],
  catalog: TriggerTypeCatalog | undefined,
): string {
  const trigger = triggers.find((candidate) => candidate.trigger_id === trigger_id);
  if (!trigger) return 'an app';
  const node_key = (trigger.trigger_config as { event_source?: { node_key?: string } } | null)
    ?.event_source?.node_key;
  const listed = node_key ? find_trigger_type(catalog, node_key) : null;
  return listed?.app.app_display_name ?? trigger.trigger_name;
}
