import { Link } from '@tanstack/react-router';
import { AppMark } from '@/components/app/app_mark';
import type { AutomationListItem } from '@/components/app/automations/automations_api';

export type TriggerApp = NonNullable<AutomationListItem['triggers'][number]['app']>;

export function apps_of(automation: AutomationListItem | null): TriggerApp[] {
  const seen = new Set<string>();
  const apps: TriggerApp[] = [];
  for (const trigger of automation?.triggers ?? []) {
    if (!trigger.app || seen.has(trigger.app.app_name)) continue;
    seen.add(trigger.app.app_name);
    apps.push(trigger.app);
  }
  return apps;
}

export function AppMarks({ apps }: { apps: TriggerApp[] }) {
  return (
    <>
      {apps.map((app) => (
        <AppMark
          iconUrl={app.icon_url ?? undefined}
          key={app.app_name}
          name={app.app_display_name}
        />
      ))}
    </>
  );
}

export function AutomationLine({
  automation,
  apps,
}: {
  automation: AutomationListItem | null;
  apps: TriggerApp[];
}) {
  if (!automation) return null;
  return (
    <Link
      className="mt-0.5 block text-muted-foreground hover:text-foreground hover:underline"
      to="/automations/$automation_id"
      params={{ automation_id: automation.automation_id }}
    >
      {automation.automation_name}
      {apps.length > 0 ? ` · ${apps.map((app) => app.app_display_name).join(', ')}` : ''}
    </Link>
  );
}
