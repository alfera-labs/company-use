import { app_event_automations_guide_url } from '@coworker/config/hosted_defaults';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@coworker/ui/components/dialog';
import { DropdownMenuItem } from '@coworker/ui/components/dropdown-menu';
import { Plug } from 'lucide-react';
import type { ReactNode } from 'react';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

const command_class = 'rounded bg-muted px-1 py-0.5 text-foreground';
const link_class = 'underline underline-offset-4 hover:text-foreground';

const app_key_steps: readonly { title: string; detail: ReactNode }[] = [
  {
    title: 'Make a Composio account and copy its API key',
    detail: (
      <>
        Composio is the app provider this install uses to reach Gmail, HubSpot, Slack and the other
        apps. Make an account at{' '}
        <a className={link_class} href="https://composio.dev" rel="noreferrer" target="_blank">
          composio.dev
        </a>
        , with a project that only this install uses. The key is in the settings of that project.
      </>
    ),
  },
  {
    title: 'Give the key to this install',
    detail: (
      <>
        On the machine that runs Alfera, run{' '}
        <code className={command_class}>./alfera add apps</code> and paste the key. It loads the app
        catalogue, which takes a few minutes.
      </>
    ),
  },
  {
    title: 'Give this install a public address',
    detail: (
      <>
        An app must be able to call this install. Run{' '}
        <code className={command_class}>./alfera add https</code>.
      </>
    ),
  },
  {
    title: 'Point Composio at this install',
    detail: (
      <>
        Tell your Composio project to send its events to this install: the guide has the one call
        that does it. Then run <code className={command_class}>./alfera add triggers</code> and
        paste the signing secret that call gave you.
      </>
    ),
  },
  {
    title: 'Reload this page',
    detail: 'The apps and their triggers then show in this menu. Choose one and press Connect.',
  },
];

/** In the trigger menu of an install with no app-provider key: the way to the steps. */
export function AppKeySetupItem({ onOpen }: { onOpen: () => void }) {
  if (useInstallHasAppCatalogue() !== false) return null;
  return (
    <DropdownMenuItem onClick={onOpen}>
      <Plug aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">Gmail, HubSpot, Slack and other apps</span>
      <span className="text-muted-foreground text-xs">Set up</span>
    </DropdownMenuItem>
  );
}

export function AppKeyStepsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>Start an automation from an app</DialogTitle>
        <DialogDescription>
          This install has no key for the app catalogue yet. Five steps set it up.
        </DialogDescription>
        <ol className="mt-2 flex flex-col gap-4">
          {app_key_steps.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
              <span className="text-muted-foreground text-sm tabular-nums">{index + 1}</span>
              <div className="min-w-0">
                <div className="font-medium text-sm">{step.title}</div>
                <p className="mt-0.5 text-muted-foreground text-sm">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 border-border/60 border-t pt-4 text-muted-foreground text-sm">
          A schedule and "When you ask" need none of this.{' '}
          <a
            className={link_class}
            href={app_event_automations_guide_url}
            rel="noreferrer"
            target="_blank"
          >
            Read the guide
          </a>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
