import { cn } from '@coworker/ui/lib/utils';
import type { ReactNode } from 'react';

export type SidebarMode = {
  mode_id: string;
  panel: ReactNode;
};

export function SidebarModeStack({
  modes,
  active_mode_id,
  className,
}: {
  modes: SidebarMode[];
  active_mode_id: string;
  className?: string;
}) {
  const active_index = Math.max(
    0,
    modes.findIndex((mode) => mode.mode_id === active_mode_id),
  );

  return (
    <div
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden max-md:min-h-40 max-md:group-data-[collapsed=true]/sidebar:hidden max-md:group-data-[ready=false]/sidebar:hidden',
        className,
      )}
    >
      {modes.map((mode, index) => {
        const is_active = index === active_index;
        const offset = index < active_index ? '-100%' : index > active_index ? '100%' : '0%';

        return (
          <div
            key={mode.mode_id}
            inert={!is_active}
            aria-hidden={!is_active}
            style={{ transform: `translateX(${offset})` }}
            className={cn(
              'absolute inset-0 flex min-h-0 flex-col transition-[transform,opacity] duration-200 ease-out-quart motion-reduce:transition-none',
              is_active ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {mode.panel}
          </div>
        );
      })}
    </div>
  );
}
