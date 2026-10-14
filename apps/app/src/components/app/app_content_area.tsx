import type { ReactNode } from 'react';

export function AppContentArea({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-screen px-8 py-7">
      {children ?? <div className="h-full min-h-[420px]" />}
    </div>
  );
}
