import {
  type AutomationConditions,
  type AutomationJudge,
  type AutomationRunPolicy,
  type AutomationUsesTools,
  automation_created_via,
  automation_statuses,
} from '@coworker/core/db/schema/automation_contracts';
import { lifecycle_columns, metadata } from '@coworker/core/db/schema/common';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

export const automations = pgTable(
  'automations',
  {
    automation_id: text('automation_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_id: text('agent_id').notNull(),
    automation_name: text('automation_name').notNull(),
    automation_status: text('automation_status', { enum: automation_statuses })
      .notNull()
      .default('enabled'),
    instruction: text('instruction').notNull(),
    instruction_version: integer('instruction_version').notNull().default(1),
    uses_tools: jsonb('uses_tools')
      .$type<AutomationUsesTools>()
      .notNull()
      .default(sql`'{"apps":[]}'::jsonb`),
    run_policy: jsonb('run_policy')
      .$type<AutomationRunPolicy>()
      .notNull()
      .default(
        sql`'{"subject_from":null,"when_a_run_is_already_going":"wait_for_it_to_finish"}'::jsonb`,
      ),
    conditions: jsonb('conditions')
      .$type<AutomationConditions>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    judge: jsonb('judge').$type<AutomationJudge>(),
    created_via: text('created_via', { enum: automation_created_via }).notNull().default('user'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_automations_workspace_status_updated').on(
      table.workspace_id,
      table.automation_status,
      table.last_updated_time.desc(),
    ),
    index('idx_automations_workspace_agent').on(
      table.workspace_id,
      table.agent_id,
      table.created_via,
      table.automation_status,
    ),
  ],
);
