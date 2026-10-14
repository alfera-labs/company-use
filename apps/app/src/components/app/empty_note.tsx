import type { ReactNode } from 'react';

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="py-1 text-muted-foreground text-sm text-pretty">{children}</div>;
}
