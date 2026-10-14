import { Skeleton } from '@coworker/ui/components/skeleton';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { NewAutomationSheet } from '@/components/app/automations/new_automation_sheet';

const automations_pages = [
  { page: 'automations', label: 'Automations', to: '/automations' },
  { page: 'activity', label: 'Activity', to: '/automations/activity' },
  { page: 'notifications', label: 'Notifications', to: '/automations/notifications' },
] as const;

export type AutomationsPageName = (typeof automations_pages)[number]['page'];

const page_link =
  'relative px-2.5 pt-1 pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-foreground after:opacity-0 aria-[current=page]:after:opacity-100';

export function AutomationsLayout({
  current,
  children,
}: {
  current?: AutomationsPageName | undefined;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col pb-10">
      <div className="mt-1 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-balance">Automations</h1>
        <NewAutomationSheet />
      </div>
      <nav aria-label="Automations pages" className="mt-7 flex gap-1 border-border border-b">
        {automations_pages.map((entry) => (
          <Link
            activeOptions={{ exact: true }}
            aria-current={entry.page === current ? 'page' : undefined}
            className={page_link}
            key={entry.page}
            to={entry.to}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      <div className="mt-5 flex flex-col">{children}</div>
    </main>
  );
}

const loading_row_keys = ['one', 'two', 'three', 'four'];

export function AutomationsLoadingRows() {
  return (
    <div className="flex flex-col gap-6 border-t pt-4">
      {loading_row_keys.map((key) => (
        <div className="flex flex-col gap-2" key={key}>
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-3.5 w-72" />
        </div>
      ))}
    </div>
  );
}
