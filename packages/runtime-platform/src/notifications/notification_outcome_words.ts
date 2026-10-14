import type { NotificationOutcome } from '@coworker/core/db/schema/automation_contracts';
import type { NotificationRules } from '@runtime-platform/notifications/notification_rules_file';

export const dial_names: Record<NotificationRules['dial'], string> = {
  off: 'Summary only',
  quiet: 'Deadlines only',
  normal: 'When it matters',
  eager: 'Everything',
};

export const outcome_words: Record<NotificationOutcome, string> = {
  notify_now: 'an interruption',
  add_to_daily_summary: 'a summary line',
  add_to_ideas_list: 'an idea',
  drop_with_reason: 'a drop',
};

export const band_words: Record<NotificationOutcome, string> = {
  notify_now: 'worth telling you now',
  add_to_daily_summary: 'can wait for the summary',
  add_to_ideas_list: 'an idea, not something to do now',
  drop_with_reason: 'not worth interrupting you',
};
