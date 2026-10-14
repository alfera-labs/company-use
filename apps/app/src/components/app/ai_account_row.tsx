import { model_source_words } from '@coworker/config/billing_words';
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
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function AiAccountRow({
  logo,
  label,
  detail,
  action,
  children,
}: {
  logo?: string | undefined;
  label: ReactNode;
  detail: ReactNode;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-3.5 py-3.5">
      <div className="flex min-h-8 items-center gap-3">
        {logo ? (
          <img
            src={logo}
            alt=""
            width={18}
            height={18}
            className="size-[18px] shrink-0 object-contain dark:invert-[0.9]"
          />
        ) : (
          <span aria-hidden className="size-[18px] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-sm">{label}</div>
          <div className="mt-0.5 text-muted-foreground text-xs">{detail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">{action}</div>
      </div>
      {children}
    </div>
  );
}

export function PaymentSourceLine({ pays_with_own_account }: { pays_with_own_account: boolean }) {
  return (
    <p className="flex items-center gap-2 px-3.5 py-3 text-muted-foreground text-sm">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${pays_with_own_account ? 'bg-positive' : 'bg-muted-foreground/40'}`}
      />
      {pays_with_own_account
        ? model_source_words.runs_use_own_account
        : model_source_words.runs_use_install_source}
    </p>
  );
}

export function ConnectedDetail() {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-positive" />
      Connected
    </span>
  );
}

export function DisconnectDialog({
  provider_label,
  falls_back_to_credits,
  open,
  on_open_change,
  on_confirm,
}: {
  provider_label: string;
  falls_back_to_credits: boolean;
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_confirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={on_open_change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {provider_label}?</AlertDialogTitle>
          <AlertDialogDescription>
            {falls_back_to_credits
              ? model_source_words.disconnect_goes_back_to_install_source
              : 'Runs keep billing your other connected account. You can connect it again whenever you want.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={on_confirm}>Disconnect</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AccountsUnavailable({
  message,
  on_retry,
}: {
  message: string;
  on_retry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3.5">
      <p className="text-muted-foreground text-sm">
        {message || 'Connected AI accounts could not be loaded.'}
      </p>
      <Button size="sm" variant="outline" onClick={on_retry}>
        <RefreshCw />
        Retry
      </Button>
    </div>
  );
}
