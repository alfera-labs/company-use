import { cn } from '@coworker/ui/lib/utils';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

export function AppMark({
  className,
  iconUrl,
  name,
  showWarning = false,
}: {
  className?: string | undefined;
  iconUrl?: string | undefined;
  name: string;
  showWarning?: boolean;
}) {
  const [icon_failed, set_icon_failed] = useState(false);
  const frame = cn('mt-px size-[17px] shrink-0', className);

  if (iconUrl && !icon_failed) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={cn(frame, 'object-contain')}
        onError={() => set_icon_failed(true)}
        src={iconUrl}
      />
    );
  }

  if (showWarning) {
    return (
      <ShieldAlert aria-hidden="true" className={cn(frame, 'stroke-[1.6] text-caution-ink')} />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        frame,
        'text-center font-medium text-[11px] text-muted-foreground leading-[17px]',
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
