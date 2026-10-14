import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function AutomationTopBar({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex h-14 items-center justify-between gap-4 border-b">
      <nav className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Link className="hover:text-foreground" to="/automations">
          Automations
        </Link>
        <ChevronRight aria-hidden="true" className="size-3.5" />
        <span className="truncate text-foreground">{name}</span>
      </nav>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
