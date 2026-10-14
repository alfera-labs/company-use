import {
  action_asks_the_person,
  type NotificationHeld,
  type NotificationOutcome,
  type NotificationUrgency,
} from '@coworker/core/db/schema/automation_contracts';
import {
  is_inside_quiet_hours,
  next_daily_summary_time,
} from '@runtime-platform/notifications/notification_clock';
import {
  band_words,
  dial_names,
  outcome_words,
} from '@runtime-platform/notifications/notification_outcome_words';
import {
  automation_is_listed,
  read_own_daily_limit,
} from '@runtime-platform/notifications/notification_rules_automation_names';
import type { NotificationRules } from '@runtime-platform/notifications/notification_rules_file';

export type NotificationDecision = {
  outcome: NotificationOutcome;
  outcome_reason: string;
  held: NotificationHeld;
};

type Decision = Omit<NotificationDecision, 'held'> & { held?: NotificationHeld };

const thresholds: Record<
  NotificationRules['dial'],
  { notify_now: number | null; add_to_daily_summary: number | null; add_to_ideas_list: number }
> = {
  eager: { notify_now: 50, add_to_daily_summary: 30, add_to_ideas_list: 10 },
  normal: { notify_now: 75, add_to_daily_summary: 40, add_to_ideas_list: 15 },
  quiet: { notify_now: 90, add_to_daily_summary: 60, add_to_ideas_list: 30 },
  off: { notify_now: null, add_to_daily_summary: null, add_to_ideas_list: 30 },
};

export type NotificationOutcomeInput = {
  policy: NotificationRules;
  score: number;
  urgency: NotificationUrgency;
  automation_id: string | null;
  automation_name?: string | null | undefined;
  expires_time: string | null;
  notifications_sent_today: number;
  notifications_sent_today_for_automation?: number | undefined;
  proposed_action_kind?: string | null | undefined;
  now: Date;
};

const idea_action_kinds = new Set(['create_automation', 'improve_automation']);

export function choose_notification_outcome(input: NotificationOutcomeInput): NotificationDecision {
  const decision = choose_outcome(input);
  const capped =
    decision.outcome === 'notify_now' ? apply_notifications_per_day_limit(input) : null;
  return { held: null, ...(capped ?? decision) };
}

function choose_outcome(input: NotificationOutcomeInput): Decision {
  const asks_the_person = action_asks_the_person(input.proposed_action_kind);
  const always = automation_is_listed(input.policy.always_notify, input);
  return (
    decide_before_the_bands(input) ??
    (always ? null : hold_below_the_bar(input, asks_the_person)) ??
    decide_to_interrupt(input, { always, asks_the_person })
  );
}

function decide_before_the_bands(input: NotificationOutcomeInput): Decision | null {
  if (input.proposed_action_kind && idea_action_kinds.has(input.proposed_action_kind)) {
    return { outcome: 'add_to_ideas_list', outcome_reason: 'an idea, not something to do now' };
  }
  if (input.policy.dial === 'off') {
    const off_band = read_band('off', input.score);
    return {
      outcome: off_band,
      outcome_reason: `you set notifications to ${dial_names.off}, so this became ${outcome_words[off_band]}`,
    };
  }
  if (input.urgency === 'system_problem') {
    return { outcome: 'notify_now', outcome_reason: "something on Alfera's side needs you" };
  }
  return null;
}

function hold_below_the_bar(input: NotificationOutcomeInput, asks_the_person: boolean) {
  const { policy, urgency } = input;
  const band = asks_the_person ? 'notify_now' : read_band(policy.dial, input.score);
  if (band !== 'notify_now') return { outcome: band, outcome_reason: band_words[band] };
  if (automation_is_listed(policy.never_notify, input)) {
    return {
      outcome: 'add_to_daily_summary' as const,
      outcome_reason: 'this automation is set to never notify',
    };
  }
  if (policy.dial === 'quiet' && urgency !== 'deadline' && urgency !== 'expires_soon') {
    return {
      outcome: 'add_to_daily_summary' as const,
      outcome_reason: `you set notifications to ${dial_names.quiet}, and this has no deadline`,
    };
  }
  return null;
}

function decide_to_interrupt(
  input: NotificationOutcomeInput,
  reach: { always: boolean; asks_the_person: boolean },
): Decision {
  if (is_inside_quiet_hours(input.now, input.policy) && !expires_before_next_daily_summary(input)) {
    return {
      outcome: 'add_to_daily_summary',
      outcome_reason: 'it is quiet hours, so it waits',
      held: { kind: 'quiet_hours' },
    };
  }
  if (reach.always) {
    return { outcome: 'notify_now', outcome_reason: 'this automation is set to always notify' };
  }
  const dial = dial_names[input.policy.dial];
  const asked =
    input.proposed_action_kind === 'connect_app' ? 'for a connection' : 'for a decision';
  return {
    outcome: 'notify_now',
    outcome_reason: reach.asks_the_person
      ? `it asks ${asked}, which reaches you on ${dial}`
      : `it is worth telling you now on ${dial}`,
  };
}

function apply_notifications_per_day_limit(input: NotificationOutcomeInput): Decision | null {
  const own_daily_limit_cap = read_own_daily_limit(input.policy, input);
  const cap = own_daily_limit_cap ?? input.policy.max_notifications_per_day;
  const spent =
    own_daily_limit_cap === null
      ? input.notifications_sent_today
      : (input.notifications_sent_today_for_automation ?? 0);
  if (spent < cap) return null;
  return {
    outcome: 'add_to_daily_summary',
    outcome_reason:
      own_daily_limit_cap === null
        ? `today's ${cap} interruptions are spent`
        : `this automation's own ${cap} interruptions for today are spent`,
    held: { kind: 'daily_cap', limit: cap },
  };
}

function read_band(dial: NotificationRules['dial'], score: number): NotificationOutcome {
  const band = thresholds[dial];
  if (band.notify_now !== null && score >= band.notify_now) return 'notify_now';
  if (band.add_to_daily_summary !== null && score >= band.add_to_daily_summary) {
    return 'add_to_daily_summary';
  }
  if (score >= band.add_to_ideas_list) return 'add_to_ideas_list';
  return 'drop_with_reason';
}

function expires_before_next_daily_summary(input: NotificationOutcomeInput) {
  if (input.urgency !== 'deadline' || !input.expires_time) return false;
  const expires = new Date(input.expires_time);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() < next_daily_summary_time(input.now, input.policy).getTime();
}
