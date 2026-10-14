import { cn } from '@coworker/ui/lib/utils';
import { Clock3, Globe, Play, Zap } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { AppMark } from '@/components/app/app_mark';
import { describe_trigger_start } from '@/components/app/automations/automation_sentences';
import type {
  AutomationListItem,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';

type ListTrigger = AutomationListItem['triggers'][number];

export function AutomationStartLine({
  automation,
  catalog,
}: {
  automation: AutomationListItem;
  catalog?: TriggerTypeCatalog | undefined;
}) {
  const stopped =
    automation.automation_status === 'enabled' ? null : status_words(automation.automation_status);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      {stopped ? <span className="me-0.5">{stopped}</span> : null}
      {automation.triggers.map((trigger) => (
        <Fragment key={trigger.trigger_id}>
          <StartChip icon={<TriggerIcon trigger={trigger} />}>
            {describe_trigger_start(trigger, catalog)}
          </StartChip>
          {needs_connection(trigger) ? (
            <StartChip caution>Connect {connection_app_words(trigger)} to start</StartChip>
          ) : null}
        </Fragment>
      ))}
      {automation.triggers.length === 0 ? <span>Nothing starts it yet</span> : null}
    </div>
  );
}

export function StartChip({
  icon,
  caution,
  children,
}: {
  icon?: ReactNode;
  caution?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border bg-raised px-2.5 text-xs',
        caution
          ? 'border-caution-ink/30 bg-caution-wash text-caution-ink'
          : 'text-muted-foreground',
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function StartTileIcon({ automation }: { automation: AutomationListItem }) {
  const first = automation.triggers[0];
  return first ? <TriggerIcon className="shrink-0" trigger={first} /> : <Zap />;
}

function TriggerIcon({
  trigger,
  className = 'size-3.5 shrink-0 text-muted-foreground',
}: {
  trigger: ListTrigger;
  className?: string;
}) {
  const frame = className;
  if (trigger.trigger_type === 'schedule') return <Clock3 aria-hidden="true" className={frame} />;
  if (trigger.trigger_type === 'manual') return <Play aria-hidden="true" className={frame} />;
  if (trigger.trigger_type === 'webhook') return <Globe aria-hidden="true" className={frame} />;
  const app = trigger.app;
  return (
    <AppMark
      className={frame}
      iconUrl={app?.icon_url ?? undefined}
      name={app?.app_display_name ?? 'App'}
    />
  );
}

function connection_app_words(trigger: ListTrigger): string {
  return trigger.app?.app_display_name ?? needs_connection(trigger) ?? 'the app';
}

export function needs_connection(trigger: ListTrigger): string | null {
  const config = trigger.trigger_config as { needs_connection?: string } | null;
  return config?.needs_connection ?? null;
}

const status_words: (status: string) => string = (status) =>
  ({ paused: 'Paused', error: 'Needs attention', archived: 'Archived' })[status] ?? status;
