import type { Participants } from '@coworker/core/access/may_use_resource';
import type { Database } from '@coworker/core/db/connection';
import type { Automation } from '@coworker/core/db/queries/automation_reads';
import type { TriggerStatus } from '@coworker/core/db/queries/trigger_writes';
import type {
  AutomationConditions,
  AutomationCreatedVia,
  AutomationJudge,
  AutomationRunPolicy,
  AutomationStatus,
} from '@coworker/core/db/schema/automation_contracts';
import type { FiredTrigger } from '@runtime-platform/events/fire_trigger';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import type { TriggerRowWithNewSecret } from '@runtime-platform/triggers/trigger_webhook_secret';

export type AutomationWithTriggers = {
  automation: Automation;
  triggers: TriggerRowWithNewSecret[];
};

export type AutomationTriggerRequest =
  | { kind: 'schedule'; cron: string; timezone?: string }
  | {
      kind: 'app_event';
      node_key: string;
      connection_id?: string;
      subscription_config?: Record<string, unknown>;
      conditions?: AutomationConditions;
    }
  | { kind: 'manual' }
  | { kind: 'webhook' };

type AutomationGathering = { participants: Participants; room_private_to: string | null };

type AutomationWrite = { workspace_id: string; automation_id: string; actor_id: string };

export type CreateAutomationRequest = {
  workspace_id: string;
  agent_id: string;
  actor_id: string;
  automation_name: string;
  instruction: string;
  triggers: AutomationTriggerRequest[];
  run_policy?: AutomationRunPolicy;
  conditions?: AutomationConditions;
  judge?: AutomationJudge;
  created_via?: AutomationCreatedVia;
  metadata?: Record<string, unknown>;
  gathering?: AutomationGathering;
};

export type UpdateAutomationRequest = AutomationWrite & {
  automation_name?: string;
  instruction?: string;
  triggers?: AutomationTriggerRequest[];
  run_policy?: AutomationRunPolicy;
  conditions?: AutomationConditions;
  judge?: AutomationJudge;
  metadata?: Record<string, unknown>;
  gathering?: AutomationGathering;
};

type ScheduledTaskIdentity = {
  workspace_id: string;
  agent_id: string;
  trigger_id: string;
  actor_id?: string;
};

export type CreateScheduledTaskRequest = {
  workspace_id: string;
  agent_id: string;
  actor_id: string;
  task_name: string;
  instruction: string;
  context_digest?: string;
  schedule_expression?: string | null;
  run_once_at?: string;
  timezone?: string;
  source_metadata?: Record<string, unknown>;
};

export type UpdateScheduledTaskRequest = ScheduledTaskIdentity & {
  actor_id: string;
  task_name?: string;
  instruction?: string;
  context_digest?: string;
  trigger_status?: TriggerStatus;
  schedule_expression?: string | null;
  run_once_at?: string;
  timezone?: string;
};

export type AutomationLifecycle = {
  create_automation: (
    db: Database,
    input: CreateAutomationRequest,
  ) => Promise<AutomationWithTriggers>;
  update_automation: (
    db: Database,
    input: UpdateAutomationRequest,
  ) => Promise<AutomationWithTriggers>;
  set_automation_status: (
    db: Database,
    input: AutomationWrite & { automation_status: AutomationStatus },
  ) => Promise<AutomationWithTriggers>;
  delete_automation: (db: Database, input: AutomationWrite) => Promise<unknown>;
  run_automation_now: (
    db: Database,
    input: AutomationWrite & { occurrence_key: string },
  ) => Promise<FiredTrigger>;
  create_scheduled_task: (db: Database, input: CreateScheduledTaskRequest) => Promise<TriggerRow>;
  update_scheduled_task: (db: Database, input: UpdateScheduledTaskRequest) => Promise<TriggerRow>;
  delete_scheduled_task: (db: Database, input: ScheduledTaskIdentity) => Promise<unknown>;
  list_scheduled_tasks: (
    db: Database,
    input: { workspace_id: string; agent_id: string; actor_id?: string },
  ) => Promise<TriggerRow[]>;
  reprovision_trigger_schedule: (trigger: TriggerRow) => Promise<void>;
};

let configured_lifecycle: AutomationLifecycle | undefined;

export function configure_automation_lifecycle(lifecycle: AutomationLifecycle) {
  configured_lifecycle = lifecycle;
}

export function read_automation_lifecycle(): AutomationLifecycle {
  if (configured_lifecycle) return configured_lifecycle;
  throw new Error(
    'The automation lifecycle is not configured. The process must call configure_automation_lifecycle at start.',
  );
}
