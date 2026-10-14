import { type Database, runs } from '@coworker/core';
import {
  type NotificationRules,
  read_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';
import { and, desc, eq } from 'drizzle-orm';

// 180 minutes is the gap the provisioned scout cron already has (8, 11, 14, 17).
// It is the calibration knob: raise it to throttle every workspace, lower it to let a denser
// cron through. Per-workspace tuning belongs in notification-rules.md the day anybody asks.
export const base_scout_interval_minutes = 180;

const interval_minutes_by_dial: Record<NotificationRules['dial'], number | null> = {
  off: null,
  quiet: base_scout_interval_minutes,
  normal: base_scout_interval_minutes,
  eager: base_scout_interval_minutes / 2,
};

export type ScoutCadenceDecision =
  | {
      should_run: true;
      dial: NotificationRules['dial'];
      policy: NotificationRules;
      weekly_review: boolean;
    }
  | { should_run: false; code: string; message: string };

export async function decide_scout_cadence(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    trigger_id: string;
    now?: Date | undefined;
    policy_readers?: Parameters<typeof read_notification_rules_file>[2] | undefined;
  },
): Promise<ScoutCadenceDecision> {
  const now = input.now ?? new Date();
  const { policy } = await read_notification_rules_file(
    db,
    { workspace_id: input.workspace_id, agent_id: input.agent_id },
    input.policy_readers ?? {},
  );
  const interval_minutes = interval_minutes_by_dial[policy.dial];
  if (interval_minutes === null) {
    return {
      should_run: false,
      code: 'attention_off',
      message: 'The dial is off in notification-rules.md, so the scout did not look.',
    };
  }

  const last_run_time = await find_last_scout_run_time(db, input);
  const weekly_review = is_first_pulse_of_the_week(now, last_run_time);
  const run = { should_run: true as const, dial: policy.dial, policy, weekly_review };
  if (!last_run_time) return run;
  const minutes_since = (now.getTime() - last_run_time.getTime()) / 60_000;
  if (minutes_since >= interval_minutes) return run;
  return {
    should_run: false,
    code: 'scout_too_soon',
    message: `The scout ran ${Math.round(minutes_since)} minutes ago and the dial '${policy.dial}' asks for ${interval_minutes} minutes between looks.`,
  };
}

export async function find_last_scout_run_time(
  db: Database,
  input: { workspace_id: string; trigger_id: string },
): Promise<Date | null> {
  const [row] = await db
    .select({ created_time: runs.created_time })
    .from(runs)
    .where(and(eq(runs.workspace_id, input.workspace_id), eq(runs.trigger_id, input.trigger_id)))
    .orderBy(desc(runs.created_time))
    .limit(1);
  return row?.created_time ?? null;
}

// Monday, and the first look of that Monday. The week is reviewed once, on the pulse that opens it.
//
// The day is read in UTC, so a workspace whose Monday morning is Sunday evening in UTC
// gets its review a few hours late. Read the timezone off notification-rules.md the day that matters.
export function is_first_pulse_of_the_week(now: Date, last_run_time: Date | null) {
  if (now.getUTCDay() !== 1) return false;
  if (!last_run_time) return true;
  return last_run_time.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
}
