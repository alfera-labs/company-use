import { Button } from '@coworker/ui/components/button';
import type { ReactNode } from 'react';
import { shows_the_app_list } from '@/components/app/integrations_catalogue_view';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

export function EmptyState({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-8 text-sm text-muted-foreground">
      <span>{title}.</span>
      {actionLabel && onAction ? (
        <Button size="sm" type="button" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** What the app list shows when it holds no app. Nothing on an install with no app catalogue. */
export function NoAppsToList({
  searchQuery,
  onClearSearch,
  children,
}: {
  searchQuery: string;
  onClearSearch: () => void;
  children: ReactNode;
}) {
  const has_app_catalogue = useInstallHasAppCatalogue() !== false;
  if (!shows_the_app_list(has_app_catalogue, searchQuery)) return null;
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        title={searchQuery ? 'No integrations found' : 'No integrations available'}
        actionLabel={searchQuery ? 'Clear search' : undefined}
        onAction={searchQuery ? onClearSearch : undefined}
      />
      {children}
    </div>
  );
}
