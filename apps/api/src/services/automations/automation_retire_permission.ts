import type { Automation } from '@coworker/core/db/queries/automation_reads';
import { AppError, describe_automation_author, may_retire_automation } from '@coworker/shared';

export function refuse_retiring_somebody_elses_automation(
  automation: Automation,
  actor_id: string,
) {
  if (may_retire_automation(automation, actor_id)) return;
  throw new AppError(
    'ask_the_person',
    `"${automation.automation_name}" was set up by ${describe_automation_author(automation)}, so retiring it needs a person's word. Write a notification with proposed_action { kind: 'retire_automation', automation_id } and ask.`,
    403,
  );
}
