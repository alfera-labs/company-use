// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { AutomationTrigger } from '@/components/app/automations/automations_api';
import { copy_text } from '@/lib/copy_text';

type WebCallAddress = NonNullable<AutomationTrigger['web_call_address']>;

export const address_only_on_this_machine_words =
  'This address works only on the machine this install runs on. A caller outside this machine needs a public address: run ./alfera add https.';

function CopyableValue({ label, value }: { label: string; value: string }) {
  const [copied, set_copied] = useState(false);
  const copy_value = async () => {
    try {
      await copy_text(value);
      set_copied(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not copy the ${label}`);
    }
  };
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        aria-label={label}
        className="h-8 font-mono text-xs"
        value={value}
        onFocus={(event) => event.target.select()}
      />
      <Button
        aria-label={`Copy the ${label}`}
        size="sm"
        type="button"
        variant="outline"
        onClick={() => void copy_value()}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** The address of a saved web-call trigger, on its row. The secret is never here. */
export function WebCallAddressLine({ address }: { address: WebCallAddress }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <CopyableValue label="Web-call address" value={address.webhook_url} />
      {address.reaches_outside_this_machine ? null : (
        <p className="text-sm text-muted-foreground">{address_only_on_this_machine_words}</p>
      )}
    </div>
  );
}

type WaitingSecret = { triggers: AutomationTrigger[]; leave: () => unknown };

/**
 * After a save that made a web-call trigger, the address and the secret stay on screen until the
 * person closes them. Only then does the page go where the save was going. A save that made no
 * such trigger leaves at once.
 */
export function use_new_web_call_secret() {
  const [waiting, set_waiting] = useState<WaitingSecret | null>(null);
  const show_then_leave = (triggers: AutomationTrigger[], leave: () => unknown) => {
    const made = triggers.filter((trigger) => trigger.new_webhook_secret);
    if (made.length === 0) return leave();
    set_waiting({ triggers: made, leave });
  };
  const close = () => {
    const leave = waiting?.leave;
    set_waiting(null);
    void leave?.();
  };
  const dialog = waiting ? <NewWebCallSecret triggers={waiting.triggers} on_done={close} /> : null;
  return { show_then_leave, dialog };
}

function NewWebCallSecret({
  triggers,
  on_done,
}: {
  triggers: AutomationTrigger[];
  on_done: () => void;
}) {
  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>The web-call trigger is ready</AlertDialogTitle>
          <AlertDialogDescription>
            Copy the secret now. It is shown only now. To get a new one, remove this trigger and add
            it again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {triggers.map((trigger) => (
          <div className="mt-4 flex flex-col gap-2" key={trigger.trigger_id}>
            {trigger.web_call_address ? (
              <WebCallAddressLine address={trigger.web_call_address} />
            ) : null}
            <CopyableValue label="Web-call secret" value={trigger.new_webhook_secret ?? ''} />
            <p className="text-sm text-muted-foreground">
              A program starts this automation with a POST request to the address and the header
              Authorization: Bearer, then the secret.
            </p>
          </div>
        ))}
        <AlertDialogFooter>
          <Button size="sm" type="button" onClick={on_done}>
            Done
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
