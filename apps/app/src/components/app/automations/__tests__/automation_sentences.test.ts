import { describe, expect, it } from 'vitest';
import {
  describe_tell_you,
  describe_trigger_start,
} from '@/components/app/automations/automation_sentences';
import type {
  AutomationTrigger,
  NotificationRules,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';

function trigger(fields: Partial<AutomationTrigger>): AutomationTrigger {
  return {
    trigger_id: 'trg_1',
    trigger_name: 'Mail arrives',
    trigger_type: 'app_event',
    trigger_status: 'enabled',
    schedule_expression: null,
    trigger_config: {},
    last_run_time: null,
    created_time: '2026-09-01T09:00:00.000Z',
    ...fields,
  } as unknown as AutomationTrigger;
}

const policy: NotificationRules = {
  dial: 'normal',
  quiet_hours: { start: '19:00', end: '08:00', timezone: 'UTC' },
  max_notifications_per_day: 5,
  daily_summary_at_time: '08:30',
  delivery_channel_order: ['slack_dm', 'email'],
  always_notify: [],
  never_notify: [],
} as unknown as NotificationRules;

const gmail_catalog = {
  count: 1,
  apps: [
    {
      app_id: 'composio_gmail',
      app_display_name: 'Gmail',
      trigger_types: [
        {
          node_key: 'composio_gmail-new_gmail_message-1',
          display_name: 'New Gmail message received',
          display_name_without_app: 'New message received',
        },
      ],
    },
  ],
} as unknown as TriggerTypeCatalog;

describe('describe_trigger_start', () => {
  it('says a schedule in words, not in cron', () => {
    const sentence = describe_trigger_start(
      trigger({ trigger_type: 'schedule', schedule_expression: '0 9 * * 1-5' }),
    );

    expect(sentence).toBe('Every weekday at 9:00');
  });

  it("names an app trigger with the catalog's own name, as the API wrote it", () => {
    const sentence = describe_trigger_start(
      trigger({
        trigger_config: { event_source: { node_key: 'composio_gmail-new_gmail_message-1' } },
      }),
      gmail_catalog,
    );

    expect(sentence).toBe('New Gmail message received');
  });

  it("falls back to the trigger's own name when the catalog is not there", () => {
    const sentence = describe_trigger_start(
      trigger({
        trigger_name: 'Email sent',
        trigger_config: {
          event_source: { node_key: 'gmail-x-1', trigger_slug: 'GMAIL_EMAIL_SENT_TRIGGER' },
        },
      }),
    );

    expect(sentence).toBe('Email sent');
  });

  it('says plainly that a manual automation only runs when asked', () => {
    expect(describe_trigger_start(trigger({ trigger_type: 'manual' }))).toBe('When you ask');
  });
});

const automation_named = { automation_id: 'atm_1', automation_name: 'Answer billing questions' };

describe('describe_tell_you', () => {
  it('reads the dial back as a promise about channels, a cap and quiet hours', () => {
    const lines = describe_tell_you(policy, automation_named);

    expect(lines[0]).toBe('Notify you on Slack, email when it matters, at most 5 times a day.');
    expect(lines[1]).toContain('19:00 and 08:00');
    expect(lines[2]).toBe('Everything else waits for the 08:30 summary.');
  });

  it('lets one automation override the dial, and says only that', () => {
    const lines = describe_tell_you({ ...policy, never_notify: ['atm_1'] }, automation_named);

    expect(lines).toEqual(['Summary only for this one.']);
  });

  it('never promises a message on its own when the dial is off', () => {
    expect(describe_tell_you({ ...policy, dial: 'off' }, automation_named)[0]).toBe(
      'Summary only. Nothing arrives on its own.',
    );
  });

  it('says an always-on automation in the same plain words as the rest', () => {
    const lines = describe_tell_you({ ...policy, always_notify: ['atm_1'] }, automation_named);

    expect(lines).toEqual(['Always notify you about this one.']);
  });
});
