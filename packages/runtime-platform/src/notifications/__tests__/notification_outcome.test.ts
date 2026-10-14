import { choose_notification_outcome } from '@runtime-platform/notifications/notification_outcome';
import {
  type NotificationRules,
  type NotificationRulesChanges,
  notification_rules_schema,
} from '@runtime-platform/notifications/notification_rules_file';
import { describe, expect, it } from 'vitest';

function policy(overrides: NotificationRulesChanges = {}) {
  return notification_rules_schema.parse({
    dial: 'normal',
    quiet_hours: null,
    max_notifications_per_day: 5,
    daily_summary_at_time: '08:30',
    delivery_channel_order: ['slack_dm', 'email', 'web'],
    always_notify: [],
    never_notify: [],
    ...overrides,
  });
}

const daytime = new Date('2026-09-15T09:00:00Z');

function decide(input: {
  policy?: NotificationRules;
  score: number;
  urgency?: 'deadline' | 'expires_soon' | 'routine' | 'fyi' | 'system_problem';
  automation_id?: string | null;
  automation_name?: string | null;
  notifications_sent_today_for_automation?: number;
  expires_time?: string | null;
  notifications_sent_today?: number;
  now?: Date;
  proposed_action_kind?: string | null;
}) {
  return choose_notification_outcome({
    proposed_action_kind: input.proposed_action_kind ?? null,
    policy: input.policy ?? policy(),
    score: input.score,
    urgency: input.urgency ?? 'fyi',
    automation_id: input.automation_id ?? null,
    automation_name: input.automation_name ?? null,
    notifications_sent_today_for_automation: input.notifications_sent_today_for_automation ?? 0,
    expires_time: input.expires_time ?? null,
    notifications_sent_today: input.notifications_sent_today ?? 0,
    now: input.now ?? daytime,
  });
}

describe('choose_notification_outcome', () => {
  it('reads the score against the bands of the mode it is in', () => {
    expect(decide({ score: 80 }).outcome).toBe('notify_now');
    expect(decide({ score: 50 }).outcome).toBe('add_to_daily_summary');
    expect(decide({ score: 20 }).outcome).toBe('add_to_ideas_list');
    expect(decide({ score: 5 }).outcome).toBe('drop_with_reason');
    expect(decide({ policy: policy({ dial: 'eager' }), score: 55 }).outcome).toBe('notify_now');
    expect(decide({ policy: policy({ dial: 'quiet' }), score: 80 }).outcome).toBe(
      'add_to_daily_summary',
    );
  });

  it('asks a question right away, whatever the score, because a question in tomorrow’s summary was never asked', () => {
    expect(decide({ score: 65, proposed_action_kind: 'offer_to_act' }).outcome).toBe('notify_now');
    expect(decide({ score: 20, proposed_action_kind: 'approve_held_call' }).outcome).toBe(
      'notify_now',
    );
    expect(decide({ score: 65, proposed_action_kind: 'none' }).outcome).toBe(
      'add_to_daily_summary',
    );
    expect(
      decide({
        policy: policy({ quiet_hours: { start: '19:00', end: '08:00', timezone: 'UTC' } }),
        score: 65,
        proposed_action_kind: 'offer_to_act',
        now: new Date('2026-09-15T22:00:00Z'),
      }).outcome,
    ).toBe('add_to_daily_summary');
  });

  it('never interrupts when attention is off, whatever the score or the urgency', () => {
    const off = policy({ dial: 'off' });
    expect(decide({ policy: off, score: 99 }).outcome).toBe('add_to_ideas_list');
    expect(decide({ policy: off, score: 99, urgency: 'deadline' }).outcome).toBe(
      'add_to_ideas_list',
    );
    expect(decide({ policy: off, score: 100, urgency: 'system_problem' }).outcome).toBe(
      'add_to_ideas_list',
    );
  });

  it('never interrupts for a question when attention is off', () => {
    const off = policy({ dial: 'off' });
    const asked = decide({ policy: off, score: 65, proposed_action_kind: 'offer_to_act' });
    expect(asked.outcome).toBe('add_to_ideas_list');
  });

  it('lets a system_problem notification through the thresholds and quiet hours', () => {
    const quiet_now = policy({
      dial: 'quiet',
      quiet_hours: { start: '19:00', end: '08:00', timezone: 'UTC' },
      max_notifications_per_day: 5,
    });
    const verdict = decide({
      policy: quiet_now,
      score: 5,
      urgency: 'system_problem',
      notifications_sent_today: 1,
      now: new Date('2026-09-15T22:00:00Z'),
    });
    expect(verdict).toEqual({
      outcome: 'notify_now',
      outcome_reason: "something on Alfera's side needs you",
      held: null,
    });
  });

  it("daily summaries a system_problem notification once the day's cap is spent", () => {
    const one_a_day = policy({ max_notifications_per_day: 1 });
    const spent = decide({
      score: 5,
      urgency: 'system_problem',
      notifications_sent_today: 1,
      policy: one_a_day,
    });
    const listed = policy({ max_notifications_per_day: 1, always_notify: ['atm_loud'] });
    const also_spent = decide({
      policy: listed,
      score: 5,
      automation_id: 'atm_loud',
      notifications_sent_today: 1,
    });

    expect(spent).toEqual({
      outcome: 'add_to_daily_summary',
      outcome_reason: "today's 1 interruptions are spent",
      held: { kind: 'daily_cap', limit: 1 },
    });
    expect(also_spent.outcome).toBe('add_to_daily_summary');
  });

  it('obeys the always and never lists in both directions, by id and by name', () => {
    const listed = policy({
      always_notify: ['atm_loud'],
      never_notify: ['competitor-news'],
    });
    expect(decide({ policy: listed, score: 5, automation_id: 'atm_loud' }).outcome).toBe(
      'notify_now',
    );
    expect(
      decide({
        policy: listed,
        score: 99,
        automation_id: 'atm_news',
        automation_name: 'Competitor news',
      }).outcome,
    ).toBe('add_to_daily_summary');
  });

  it('spends an automation own daily limit instead of the general cap, and clamps it to the ceiling', () => {
    const paged = policy({
      max_notifications_per_day: 2,
      always_notify: ['flight-watch'],
      own_daily_limit: { 'flight-watch': 40 },
    });
    expect(paged.own_daily_limit['flight-watch']).toBe(30);
    const own_limit_run = {
      policy: paged,
      score: 5,
      automation_id: 'atm_flight',
      automation_name: 'Flight watch',
    };
    expect(
      decide({
        ...own_limit_run,
        notifications_sent_today: 9,
        notifications_sent_today_for_automation: 3,
      }).outcome,
    ).toBe('notify_now');
    const own_limit_spent = decide({
      ...own_limit_run,
      notifications_sent_today: 0,
      notifications_sent_today_for_automation: 30,
    });
    expect(own_limit_spent.outcome).toBe('add_to_daily_summary');
    expect(own_limit_spent.outcome_reason).toContain("automation's own");
  });

  it('spends a daily cap and daily summaries everything after it', () => {
    const capped = policy({ max_notifications_per_day: 2 });
    expect(decide({ policy: capped, score: 99, notifications_sent_today: 1 }).outcome).toBe(
      'notify_now',
    );
    const spent = decide({ policy: capped, score: 99, notifications_sent_today: 2 });
    expect(spent.outcome).toBe('add_to_daily_summary');
    expect(spent.outcome_reason).toContain('spent');
  });

  it('holds an ordinary notification until the quiet hours are over', () => {
    const quiet_hours = policy({
      quiet_hours: { start: '19:00', end: '08:00', timezone: 'UTC' },
    });
    const at_night = new Date('2026-09-15T22:00:00Z');
    expect(decide({ policy: quiet_hours, score: 99, now: at_night }).outcome).toBe(
      'add_to_daily_summary',
    );
    expect(decide({ policy: quiet_hours, score: 99 }).outcome).toBe('notify_now');
  });

  it('lets a deadline that expires before the daily summary cross the quiet hours', () => {
    const quiet_hours = policy({ quiet_hours: { start: '19:00', end: '08:00', timezone: 'UTC' } });
    const at_night = new Date('2026-09-15T22:00:00Z');
    const before_the_daily_summary = decide({
      policy: quiet_hours,
      score: 99,
      urgency: 'deadline',
      expires_time: '2026-09-16T06:00:00Z',
      now: at_night,
    });
    const after_the_daily_summary = decide({
      policy: quiet_hours,
      score: 99,
      urgency: 'deadline',
      expires_time: '2026-09-16T18:00:00Z',
      now: at_night,
    });
    expect(before_the_daily_summary.outcome).toBe('notify_now');
    expect(after_the_daily_summary.outcome).toBe('add_to_daily_summary');
  });

  it('only interrupts quiet mode for time-bound news', () => {
    const quiet = policy({ dial: 'quiet' });
    expect(decide({ policy: quiet, score: 95, urgency: 'routine' }).outcome).toBe(
      'add_to_daily_summary',
    );
    expect(decide({ policy: quiet, score: 95, urgency: 'expires_soon' }).outcome).toBe(
      'notify_now',
    );
  });

  it('names the dial the way the Notify me setting does', () => {
    expect(decide({ policy: policy({ dial: 'off' }), score: 99 }).outcome_reason).toBe(
      'you set notifications to Summary only, so this became an idea',
    );
    expect(decide({ policy: policy({ dial: 'quiet' }), score: 95 }).outcome_reason).toBe(
      'you set notifications to Deadlines only, and this has no deadline',
    );
    expect(decide({ score: 80 }).outcome_reason).toBe(
      'it is worth telling you now on When it matters',
    );
    expect(
      decide({ policy: policy({ dial: 'eager' }), score: 20, proposed_action_kind: 'offer_to_act' })
        .outcome_reason,
    ).toBe('it asks for a decision, which reaches you on Everything');
  });
});
