import { Switch } from '@coworker/ui/components/switch';
import { useQuery } from '@tanstack/react-query';
import {
  type AutomationWithTriggers,
  list_automation_fires,
  list_automations,
} from '@/components/app/automations/automations_api';
import { describe_budget_pause } from '@/components/app/automations/fire_outcome_words';
import { list_workspace_members, relative_time } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function AutomationStatusLine({
  automation,
  busy,
  onTurn,
}: {
  automation: AutomationWithTriggers['automation'];
  busy: boolean;
  onTurn: (live: boolean) => void;
}) {
  const automation_id = automation.automation_id;
  const live = automation.automation_status === 'enabled';
  const fires_query = useQuery({
    queryKey: query_keys.automation_fires(automation_id),
    queryFn: () => list_automation_fires(automation_id, { page: 1, page_size: 20 }),
    refetchInterval: 15_000,
  });
  const list_query = useQuery({ queryKey: query_keys.automations(), queryFn: list_automations });
  const members_query = useQuery({
    queryKey: query_keys.workspace_members(),
    queryFn: list_workspace_members,
  });
  const listed = (list_query.data ?? []).find((row) => row.automation_id === automation_id);
  const author_name = read_author_name(members_query.data, automation.created_by);
  const budget_pause = live ? null : describe_budget_pause(fires_query.data?.items[0]);

  return (
    <div className="mt-2.5 flex items-center gap-3 text-sm text-muted-foreground">
      <Switch
        aria-label={`Turn ${automation.automation_name} ${live ? 'off' : 'on'}`}
        checked={live}
        disabled={busy}
        onCheckedChange={onTurn}
      />
      <span>{live ? 'Active' : budget_pause ? `Paused: ${budget_pause}` : 'Paused'}</span>
      {author_name ? (
        <>
          <span aria-hidden="true">|</span>
          <span>By {author_name}</span>
        </>
      ) : null}
      <span aria-hidden="true">|</span>
      <span>
        {listed
          ? `${listed.run_count === 1 ? '1 run' : `${listed.run_count} runs`}, last ${relative_time(as_iso(listed.last_run_time))}`
          : 'No runs yet'}
      </span>
    </div>
  );
}

function read_author_name(
  members: { user_id: string; first_name: string | null; email: string }[] | undefined,
  created_by: string | undefined,
): string | null {
  const member = (members ?? []).find((candidate) => candidate.user_id === created_by);
  if (!member) return null;
  return member.first_name?.trim() || member.email;
}

function as_iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
