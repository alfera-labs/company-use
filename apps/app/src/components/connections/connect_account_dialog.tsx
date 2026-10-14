import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button, buttonVariants } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { Check, ChevronDown, Lock, Users, X } from 'lucide-react';
import { useId, useState } from 'react';
import { use_team_viewer_role } from '@/components/app/use_team_mode';
import type { IntegrationApp } from '@/lib/api/types';
import { indefinite_article_for } from '@/lib/indefinite_article';

export type ConnectionAccessType = 'shared' | 'restricted';

const access_options = [
  { value: 'shared', label: 'Team-only', icon: Users },
  { value: 'restricted', label: 'Private (Invite only)', icon: Lock },
] as const satisfies ReadonlyArray<{
  value: ConnectionAccessType;
  label: string;
  icon: typeof Users;
}>;

/**
 * A team-mode install is shared by several people, so there an account starts as the
 * connecting person's alone. Everywhere else it starts shared, as before.
 */
export function access_a_new_account_starts_with(runs_in_team_mode: boolean): ConnectionAccessType {
  return runs_in_team_mode ? 'restricted' : 'shared';
}

/** Said in the dialog of a team-mode install: who can use the account, and how to share it. */
export const who_can_use_it_words: Record<ConnectionAccessType, string> = {
  restricted:
    'Only you can use this account, in your chats. To share it, choose Team-only here, or open the account under Integrations later and add people.',
  shared:
    'Everyone on the team can use this account in their chats, and scheduled tasks can use it too.',
};

function CloseButton({ on_close }: { on_close: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={on_close}
      className="absolute -top-1 -right-1 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}

export function ConnectAccountDialog({
  app,
  isConnecting = false,
  onClose,
  onConnect,
}: {
  app: IntegrationApp | null;
  isConnecting?: boolean;
  onClose: () => void;
  onConnect: (opts: { connection_name?: string; access_type: ConnectionAccessType }) => void;
}) {
  return (
    <AlertDialog open={app !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-lg rounded-2xl p-6">
        {app ? (
          <ConnectAccountForm
            key={app.app_id}
            app={app}
            isConnecting={isConnecting}
            onClose={onClose}
            onConnect={onConnect}
          />
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConnectAccountForm({
  app,
  isConnecting,
  onClose,
  onConnect,
}: {
  app: IntegrationApp;
  isConnecting: boolean;
  onClose: () => void;
  onConnect: (opts: { connection_name?: string; access_type: ConnectionAccessType }) => void;
}) {
  const nickname_id = useId();
  const [name, set_name] = useState('');
  const runs_in_team_mode = use_team_viewer_role() !== null;
  const [access, set_access] = useState(access_a_new_account_starts_with(runs_in_team_mode));

  const selected = access_options.find((option) => option.value === access) ?? access_options[0];
  const SelectedIcon = selected.icon;

  function start() {
    const trimmed = name.trim();
    onConnect({ ...(trimmed ? { connection_name: trimmed } : {}), access_type: access });
  }

  return (
    <>
      <div className="relative">
        <AlertDialogTitle className="text-xl font-semibold">
          Connect {indefinite_article_for(app.app_display_name)} {app.app_display_name} account
        </AlertDialogTitle>
        <CloseButton on_close={onClose} />
      </div>

      <div className="mt-5 grid gap-1.5">
        <Label htmlFor={nickname_id}>Name for this account</Label>
        <Input
          id={nickname_id}
          value={name}
          placeholder="My Account"
          autoComplete="off"
          onChange={(event) => set_name(event.target.value)}
        />
        <p className="text-sm text-muted-foreground">Just a label to tell your accounts apart.</p>
        {runs_in_team_mode ? (
          <p className="text-sm text-muted-foreground">{who_can_use_it_words[access]}</p>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className={buttonVariants({ variant: 'outline' })}>
                <SelectedIcon className="size-4" aria-hidden="true" />
                {selected.label}
                <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
              </button>
            }
          />
          <DropdownMenuContent
            align="start"
            className="w-64"
            collisionAvoidance={{ side: 'none', align: 'none' }}
          >
            <DropdownMenuLabel className="text-sm font-medium text-foreground">
              Who should have access?
            </DropdownMenuLabel>
            {access_options.map((option) => {
              const OptionIcon = option.icon;
              return (
                <DropdownMenuItem key={option.value} onClick={() => set_access(option.value)}>
                  <OptionIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 font-medium text-foreground">{option.label}</span>
                  {option.value === access ? (
                    <Check className="size-4 text-brand-ink" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button type="button" disabled={isConnecting} onClick={start}>
          {isConnecting ? 'Connecting…' : `Continue to ${app.app_display_name}`}
        </Button>
      </div>
    </>
  );
}
