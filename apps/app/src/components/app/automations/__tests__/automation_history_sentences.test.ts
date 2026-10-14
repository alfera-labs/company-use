import { describe, expect, it } from 'vitest';
import { build_automation_history } from '@/components/app/automations/automation_sentences';
import type { AutomationFire, Notification } from '@/components/app/automations/automations_api';
import { history_outcome_words } from '@/components/app/automations/fire_outcome_words';

const fire = (fields: Record<string, unknown>): AutomationFire =>
  ({
    event_id: 'evt_1',
    fired_time: '2026-09-10T09:00:00.000Z',
    trigger_id: 'trg_1',
    trigger_name: 'Mail arrives',
    outcome: 'fired',
    reason: null,
    skipped: null,
    judge: null,
    budget_limit: null,
    run_id: 'run_1',
    session_id: 'ses_1',
    told: null,
    ...fields,
  }) as unknown as AutomationFire;

function quiet_notification(fields: Record<string, unknown>): Notification {
  return {
    event_id: 'evt_quiet',
    outcome: 'drop_with_reason',
    created_time: '2026-09-10T10:00:00.000Z',
    notification: {
      title: 'Newsletter from Acme',
      outcome_reason: 'A newsletter is not news.',
      session_id: 'ses_quiet',
    },
    ...fields,
  } as unknown as Notification;
}

describe('build_automation_history', () => {
  it('lists only real starts, newest first, with no row for a trigger that never started', () => {
    const rows = build_automation_history({
      fires: [
        fire({ event_id: 'evt_old', fired_time: '2026-09-09T09:00:00.000Z' }),
        fire({ event_id: 'evt_new', fired_time: '2026-09-10T09:00:00.000Z' }),
      ],
      notifications: [],
    });

    expect(rows.map((row) => row.row_key)).toEqual(['evt_new', 'evt_old']);
    expect(rows.every((row) => row.session_id === 'ses_1')).toBe(true);
    expect(build_automation_history({ fires: [], notifications: [] })).toEqual([]);
  });

  it('shows a notification it chose not to raise as a row with its reason', () => {
    const rows = build_automation_history({
      fires: [fire({ event_id: 'evt_run' })],
      notifications: [
        quiet_notification({}),
        quiet_notification({ event_id: 'evt_idea', outcome: 'add_to_ideas_list' }),
        quiet_notification({ event_id: 'evt_sent', outcome: 'notify_now' }),
      ],
    });

    expect(rows.map((row) => row.row_key)).toEqual(['evt_quiet', 'evt_idea', 'evt_run']);
    expect(rows[0]).toMatchObject({
      headline: 'Newsletter from Acme',
      sentence: 'Stayed quiet: A newsletter is not news.',
      session_id: 'ses_quiet',
    });
    expect(rows[1]?.sentence).toBe('Parked on Ideas: A newsletter is not news.');
  });

  it('does not list a notification twice when its run already says what it told you', () => {
    const told = { notification_event_id: 'evt_quiet', outcome: 'drop_with_reason' };
    const rows = build_automation_history({
      fires: [fire({ event_id: 'evt_run', told: { ...told, outcome_reason: 'x' } })],
      notifications: [quiet_notification({})],
    });

    expect(rows.map((row) => row.row_key)).toEqual(['evt_run']);
  });

  it('reads an outcome back in words a person uses, not the database ones', () => {
    expect(history_outcome_words.fired).toBe('Ran');
    expect(history_outcome_words.skipped).toBe('Filtered');
    expect(history_outcome_words.didnt_fire).toBe('Did not run');
  });

  it('shows a turned-away fire with the reason on the row', () => {
    const rows = build_automation_history({
      fires: [
        fire({ event_id: 'evt_waiting', outcome: 'waiting' }),
        fire({
          event_id: 'evt_skipped',
          outcome: 'skipped',
          skipped: { stage: 'judge', reason: 'it reads like a newsletter' },
          judge: { confidence: 0.3, threshold: 0.7 },
          run_id: null,
          session_id: null,
        }),
      ],
      notifications: [],
    });

    expect(rows.map((row) => row.outcome).sort()).toEqual(['skipped', 'waiting']);
    expect(rows.find((row) => row.outcome === 'skipped')?.sentence).toBe(
      'Not a match: it reads like a newsletter',
    );
  });
});
