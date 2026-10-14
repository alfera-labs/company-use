import { cn } from '@coworker/ui/lib/utils';
import type { ReactNode } from 'react';

export function ListCard({ off, children }: { off: boolean; children: ReactNode }) {
  return (
    <li
      className={cn(
        'relative flex items-center gap-3.5 rounded-3xl border bg-raised px-4 py-3.5 shadow-raised transition-colors hover:border-foreground/20',
        off && 'bg-raised/60',
      )}
      data-off={off || undefined}
    >
      {children}
    </li>
  );
}

export function LeadTile({ goal, children }: { goal?: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[17px] [&_img]:size-[17px]',
        goal ? 'bg-brand-wash text-brand-ink' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

export function CardBody({ off, children }: { off: boolean; children: ReactNode }) {
  return <div className={cn('min-w-0 flex-1', off && 'opacity-60')}>{children}</div>;
}

export function WhatItDoes({ instruction }: { instruction: string }) {
  const first_line = instruction.trim().split('\n')[0]?.trim();
  if (!first_line) return null;
  return <p className="mt-0.5 truncate text-sm text-muted-foreground">{first_line}</p>;
}
