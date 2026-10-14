import type {
  NotificationHeld,
  NotificationOutcome,
} from '@coworker/core/db/schema/automation_contracts';

export type AutomationFireOutcome = 'fired' | 'running' | 'skipped' | 'waiting' | 'didnt_fire';

export type AutomationFireTold = {
  notification_event_id: string;
  title: string;
  outcome: NotificationOutcome;
  outcome_reason: string;
  held: NotificationHeld;
  delivered_on: string | null;
  delivery_error: string | null;
  asks_the_person: boolean;
  open: boolean;
};

export type AutomationFireSkipStage = 'rule' | 'judge' | 'human' | 'listen';

export type AutomationFire = {
  event_id: string;
  fired_time: Date;
  trigger_id: string;
  trigger_name: string | null;
  outcome: AutomationFireOutcome;
  reason: string | null;
  skipped: { stage: AutomationFireSkipStage; reason: string } | null;
  judge: { confidence: number; threshold: number } | null;
  budget_limit: number | null;
  run_id: string | null;
  session_id: string | null;
  triage: string | null;
  subject_source: string | null;
  told: AutomationFireTold | null;
};

export type FireRow = {
  event_id: string;
  fired_time: Date;
  trigger_id: string;
  trigger_name: string | null;
  job_status: string | null;
  result_data: Record<string, unknown> | null;
  error_data: Record<string, unknown> | null;
  run_id: string | null;
  run_session_id?: string | null;
  run_status?: string | null;
  triage_result?: Record<string, unknown> | null;
};
