import type { AutomationFire, Notification } from '@/components/app/automations/automations_api';

type FireSkip = NonNullable<AutomationFire['skipped']>;
type FireTold = NonNullable<AutomationFire['told']>;

export const history_outcome_words: Record<AutomationFire['outcome'], string> = {
  fired: 'Ran',
  running: 'Working',
  waiting: 'Waiting',
  skipped: 'Filtered',
  didnt_fire: 'Did not run',
};

const delivered_on_words: Record<string, string> = {
  slack_dm: 'Told you on Slack',
  chat: 'Told you in chat',
  email: 'Told you by email',
  web: 'Told you on this page',
};

const skip_stage_words: Record<FireSkip['stage'], { words: string; keeps_detail: boolean }> = {
  rule: { words: 'Your checks said no', keeps_detail: true },
  judge: { words: 'Not a match', keeps_detail: true },
  human: { words: 'You took over the thread', keeps_detail: false },
  listen: { words: 'Only watching', keeps_detail: false },
};

export function describe_fire_outcome(fire: AutomationFire, summary_time?: string): string {
  if (fire.outcome === 'skipped') return describe_skipped_fire(fire);
  if (fire.outcome === 'didnt_fire') return describe_run_problem(fire);
  if (fire.outcome !== 'fired') return history_outcome_words[fire.outcome];
  return fire.told ? describe_told(fire.told, summary_time) : 'Ran, nothing to tell you';
}

function describe_told(told: FireTold, summary_time: string | undefined): string {
  if (told.outcome === 'notify_now') {
    if (told.delivery_error) return `Could not reach you: ${told.delivery_error}`;
    return delivered_on_words[told.delivered_on ?? ''] ?? 'Told you';
  }
  if (told.outcome === 'add_to_daily_summary') {
    return `Saved for ${summary_words(summary_time)} — ${describe_hold_reason(told)}`;
  }
  if (told.outcome === 'add_to_ideas_list') return 'Parked on Ideas';
  return `Dropped: ${told.outcome_reason}`;
}

export function describe_skip(skip: FireSkip): string {
  const known = skip_stage_words[skip.stage];
  const detail = skip.reason.trim();
  return known.keeps_detail && detail ? `${known.words}: ${detail}` : known.words;
}

function describe_skipped_fire(fire: AutomationFire): string {
  return fire.skipped ? describe_skip(fire.skipped) : history_outcome_words.skipped;
}

function describe_run_problem(fire: AutomationFire): string {
  const budget = read_budget_limit(fire);
  if (budget !== null) return `Did not run: hit ${budget} events today, so it paused`;
  return fire.reason ? `Did not run: ${fire.reason.replace(/\.$/, '')}` : 'Did not run';
}

export function describe_budget_pause(newest_fire: AutomationFire | undefined): string | null {
  const budget = newest_fire ? read_budget_limit(newest_fire) : null;
  return budget === null ? null : `hit ${budget} events today`;
}

function read_budget_limit(fire: AutomationFire): number | null {
  return fire.budget_limit ?? read_legacy_budget_limit(fire.reason);
}

type HoldSource = {
  held?: Notification['notification']['held'] | undefined;
  outcome_reason: string;
};

export function describe_hold_reason(source: HoldSource): string {
  const held = source.held;
  if (held?.kind === 'daily_cap') return `held: today's ${held.limit} interruptions are spent`;
  if (held?.kind === 'quiet_hours') return 'held for quiet hours';
  return source.outcome_reason;
}

export function summary_words(summary_time: string | undefined): string {
  return summary_time ? `the ${summary_time} summary` : 'the daily summary';
}

// An older start has no `budget_limit`; the API wrote it into the reason, "... past
// its budget of 50". Delete this when the history holds no such start.
function read_legacy_budget_limit(reason: string | null): number | null {
  const budget = /past its budget of (\d+)/.exec(reason ?? '');
  return budget ? Number(budget[1]) : null;
}
