import { buttonVariants } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { Check, ExternalLink, Loader2, Plus } from 'lucide-react';

export type ConnectionSetupCardApp = {
  app_id?: string;
  app_name: string;
  app_display_name: string;
  description?: string;
  icon_url?: string;
};

export function ConnectionSetupCard({
  app,
  buttonLabel,
  className,
  disabled = false,
  href,
  isLoading = false,
  status,
}: {
  app: ConnectionSetupCardApp;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean | undefined;
  href?: string | undefined;
  isLoading?: boolean | undefined;
  status?: 'connected' | 'ready' | 'starting' | undefined;
}) {
  const label = buttonLabel ?? (status === 'connected' ? 'Connected' : 'Connect');
  const icon = connection_action_icon(status, isLoading);

  return (
    <div
      className={cn(
        'grid w-full max-w-xl grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-background px-3 py-2.5 shadow-xs',
        className,
      )}
    >
      <ConnectionAppMark app={app} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{app.app_display_name}</div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {app.description ?? format_label(app.app_display_name)}
        </div>
      </div>
      {href && !disabled ? (
        <a
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          href={href}
          rel="noreferrer"
          target="_blank"
        >
          {icon}
          {label}
        </a>
      ) : (
        <span
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'pointer-events-none opacity-60',
          )}
        >
          {icon}
          {label}
        </span>
      )}
    </div>
  );
}

function ConnectionAppMark({ app }: { app: ConnectionSetupCardApp }) {
  return (
    <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-3xl border border-border bg-background text-xs font-medium">
      {app.icon_url ? (
        <span
          className="size-full bg-contain bg-center bg-no-repeat p-1"
          style={{ backgroundImage: `url("${app.icon_url}")` }}
          aria-hidden="true"
        />
      ) : (
        app.app_display_name.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

function connection_action_icon(
  status: 'connected' | 'ready' | 'starting' | undefined,
  loading: boolean,
) {
  if (loading || status === 'starting') {
    return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  }
  if (status === 'connected') return <Check className="size-4" aria-hidden="true" />;
  if (status === 'ready') return <ExternalLink className="size-4" aria-hidden="true" />;
  return <Plus className="size-4" aria-hidden="true" />;
}

function format_label(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
