import { type Database, set_scheduled_task_authority } from '@coworker/core';
import { update_trigger } from '@coworker/core/db/queries/trigger_writes';
import { id_prefixes, is_id } from '@coworker/shared';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';

function sign_for_the_author(
  source: Record<string, unknown> | null | undefined,
  actor_id: string,
  instruction: string,
) {
  if (!can_sign_automations(actor_id)) {
    return set_scheduled_task_authority(source, 'system:not_an_author', instruction);
  }
  return set_scheduled_task_authority(source, actor_id, instruction);
}

function can_sign_automations(actor_id: string) {
  return actor_id.startsWith('user_') || is_id(actor_id, id_prefixes.api_key);
}

export function build_automation_trigger_source(input: {
  automation_id: string;
  actor_id: string;
  instruction: string;
}) {
  return sign_for_the_author(
    { origin: 'automation', automation_id: input.automation_id },
    input.actor_id,
    input.instruction,
  );
}

export async function resign_automation_trigger_authority(
  db: Database,
  triggers: TriggerRow[],
  input: { actor_id: string; instruction: string },
): Promise<TriggerRow[]> {
  return Promise.all(
    triggers.map((trigger) =>
      update_trigger(db, {
        workspace_id: trigger.workspace_id,
        trigger_id: trigger.trigger_id,
        trigger_source: sign_for_the_author(
          trigger.trigger_source,
          input.actor_id,
          input.instruction,
        ),
        actor_id: input.actor_id,
      }),
    ),
  );
}
