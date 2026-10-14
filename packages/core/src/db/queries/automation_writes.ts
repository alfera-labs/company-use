import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { automations } from '@coworker/core/db/schema';
import type {
  AutomationConditions,
  AutomationCreatedVia,
  AutomationJudge,
  AutomationRunPolicy,
  AutomationStatus,
  AutomationUsesTools,
} from '@coworker/core/db/schema/automation_contracts';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, eq, sql } from 'drizzle-orm';

export type CreateAutomationInput = {
  workspace_id: string;
  agent_id: string;
  automation_name: string;
  instruction: string;
  uses_tools?: AutomationUsesTools | undefined;
  run_policy?: AutomationRunPolicy | undefined;
  conditions?: AutomationConditions | undefined;
  judge?: AutomationJudge | undefined;
  created_via?: AutomationCreatedVia | undefined;
  metadata?: Record<string, unknown> | undefined;
  actor_id: string;
};

export type UpdateAutomationInput = {
  workspace_id: string;
  automation_id: string;
  automation_name?: string | undefined;
  instruction?: string | undefined;
  uses_tools?: AutomationUsesTools | undefined;
  run_policy?: AutomationRunPolicy | undefined;
  conditions?: AutomationConditions | undefined;
  judge?: AutomationJudge | undefined;
  metadata?: Record<string, unknown> | undefined;
  actor_id: string;
};

export async function create_automation(db: DatabaseExecutor, input: CreateAutomationInput) {
  const [automation] = await db
    .insert(automations)
    .values({
      automation_id: create_id(id_prefixes.automation),
      workspace_id: input.workspace_id,
      agent_id: input.agent_id,
      automation_name: input.automation_name,
      instruction: input.instruction,
      uses_tools: input.uses_tools ?? { apps: [] },
      run_policy: input.run_policy ?? {
        subject_from: null,
        when_a_run_is_already_going: 'wait_for_it_to_finish',
      },
      conditions: input.conditions ?? [],
      judge: input.judge ?? null,
      created_via: input.created_via ?? 'user',
      metadata: input.metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(automation, 'automation');
}

export async function update_automation(db: Database, input: UpdateAutomationInput) {
  const [automation] = await db
    .update(automations)
    .set({
      ...(input.automation_name === undefined ? {} : { automation_name: input.automation_name }),
      ...(input.instruction === undefined
        ? {}
        : {
            instruction: input.instruction,
            instruction_version: sql`case when ${automations.instruction} = ${input.instruction}
              then ${automations.instruction_version} else ${automations.instruction_version} + 1 end`,
          }),
      ...(input.uses_tools === undefined ? {} : { uses_tools: input.uses_tools }),
      ...(input.run_policy === undefined ? {} : { run_policy: input.run_policy }),
      ...(input.conditions === undefined ? {} : { conditions: input.conditions }),
      ...(input.judge === undefined ? {} : { judge: input.judge }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_id, input.automation_id),
      ),
    )
    .returning();

  return automation ?? null;
}

export async function set_automation_status(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    automation_id: string;
    automation_status: AutomationStatus;
    actor_id: string;
  },
) {
  const [automation] = await db
    .update(automations)
    .set({
      automation_status: input.automation_status,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(automations.workspace_id, input.workspace_id),
        eq(automations.automation_id, input.automation_id),
      ),
    )
    .returning();

  return automation ?? null;
}

export async function archive_automation(
  db: Database,
  input: { workspace_id: string; automation_id: string; actor_id: string },
) {
  return set_automation_status(db, { ...input, automation_status: 'archived' });
}
