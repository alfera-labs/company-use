import { cn } from '@coworker/ui/lib/utils';
import type * as React from 'react';

function SettingsSection({
  title,
  description,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="settings-section" className={cn('flex flex-col gap-3.5', className)}>
      <div className="flex max-w-[65ch] flex-col gap-1">
        <h2 className="font-medium text-base text-foreground">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-sm text-pretty">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SettingsCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="settings-card"
      className={cn('panel flex flex-col divide-y divide-border', className)}
      {...props}
    />
  );
}

function SettingsRow({
  title,
  description,
  htmlFor,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        'flex min-h-15 flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-3.5 py-3.5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-foreground text-sm">
            {title}
          </label>
        ) : (
          <div className="text-foreground text-sm">{title}</div>
        )}
        {description ? (
          <div className="text-muted-foreground text-xs text-pretty">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex min-w-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

export { SettingsCard, SettingsRow, SettingsSection };
