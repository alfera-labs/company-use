import { id_prefixes, is_id } from '@shared/id';

type AutomationAuthorship = {
  created_by: string;
  created_via: string;
  metadata: Record<string, unknown>;
};

const agent_born_via = ['agent_tool', 'automation_miner'];

export function may_retire_automation(automation: AutomationAuthorship, actor_id: string) {
  if (actor_id.startsWith('user_')) return true;
  if (is_id(actor_id, id_prefixes.api_key) && automation.created_by === actor_id) return true;
  if (!agent_born_via.includes(automation.created_via)) return false;
  return !automation.created_by.startsWith('user_') || is_a_task_born_watcher(automation);
}

export function is_another_persons_automation(
  automation: Pick<AutomationAuthorship, 'created_by'>,
  actor_id: string,
) {
  const set_up_by_a_person = automation.created_by.startsWith('user_');
  return set_up_by_a_person && actor_id.startsWith('user_') && automation.created_by !== actor_id;
}

function is_a_task_born_watcher(automation: AutomationAuthorship) {
  return automation.metadata?.expires_with_parent === true;
}

export function describe_automation_author(automation: Pick<AutomationAuthorship, 'created_by'>) {
  if (automation.created_by.startsWith('user_')) return 'a person';
  if (is_id(automation.created_by, id_prefixes.api_key)) return 'an API key';
  return 'another run';
}
