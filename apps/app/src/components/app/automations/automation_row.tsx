import { Button } from '@coworker/ui/components/button';
import { Switch } from '@coworker/ui/components/switch';
import { Link } from '@tanstack/react-router';
import { Target } from 'lucide-react';
import {
  type AutomationKind,
  automation_display_name,
  KindChip,
  kind_of_automation,
} from '@/components/app/automations/automation_kind';
import {
  CardBody,
  LeadTile,
  ListCard,
  WhatItDoes,
} from '@/components/app/automations/automation_list_card';
import {
  AutomationStartLine,
  needs_connection,
  StartTileIcon,
} from '@/components/app/automations/automation_start_line';
import type {
  AutomationListItem,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import { relative_time } from '@/lib/api';

export function AutomationRow({
  automation,
  kind,
  onPickKind,
  isPending,
  catalog,
  onSetLive,
}: {
  automation: AutomationListItem;
  kind: AutomationKind | null;
  onPickKind: (kind: AutomationKind) => void;
  isPending: boolean;
  catalog: TriggerTypeCatalog | undefined;
  onSetLive: (live: boolean) => void;
}) {
  const waiting_for_connection = automation.triggers.some((trigger) => needs_connection(trigger));
  const live = automation.automation_status === 'enabled';
  const own_kind = kind_of_automation(automation);
  return (
    <ListCard off={!live}>
      <LeadTile goal={own_kind === 'goal'}>
        {own_kind === 'goal' ? <Target /> : <StartTileIcon automation={automation} />}
      </LeadTile>
      <CardBody off={!live}>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            className="truncate text-sm font-medium after:absolute after:inset-0"
            to="/automations/$automation_id"
            params={{ automation_id: automation.automation_id }}
          >
            {automation_display_name(automation, own_kind)}
          </Link>
          {kind ? <KindChip kind={kind} onPick={onPickKind} /> : null}
        </div>
        <WhatItDoes instruction={automation.instruction} />
        <AutomationStartLine automation={automation} catalog={catalog} />
      </CardBody>
      {waiting_for_connection ? (
        <Button
          className="relative z-10"
          render={<Link to="/integrations" />}
          size="sm"
          variant="outline"
        >
          Connect
        </Button>
      ) : (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {describe_last_run(automation)}
        </span>
      )}
      <Switch
        className="relative z-10"
        aria-label={`Turn ${automation.automation_name} ${live ? 'off' : 'on'}`}
        checked={live}
        disabled={isPending}
        onCheckedChange={onSetLive}
      />
    </ListCard>
  );
}

function describe_last_run(automation: AutomationListItem): string {
  if (!automation.last_run_time) return 'never ran';
  return `ran ${relative_time(as_iso(automation.last_run_time))}`;
}

function as_iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}
