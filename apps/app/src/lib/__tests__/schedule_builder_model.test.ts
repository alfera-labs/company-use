import { describe, expect, it } from 'vitest';
import {
  cron_to_draft,
  default_schedule_draft,
  draft_to_cron,
  draft_to_run_once_at,
  type ScheduleDraft,
} from '@/lib/schedule_builder_model';

function draft(patch: Partial<ScheduleDraft>): ScheduleDraft {
  return { ...default_schedule_draft, ...patch };
}

describe('draft_to_cron', () => {
  it('builds hourly crons (minute fixed, rest wildcard)', () => {
    expect(draft_to_cron(draft({ frequency: 'hourly', minute: 30 }))).toBe('30 * * * *');
  });

  it('builds daily crons at a fixed time', () => {
    expect(draft_to_cron(draft({ frequency: 'daily', hour: 9, minute: 0 }))).toBe('0 9 * * *');
  });

  it('builds interval crons for minutes, hours, and calendar days', () => {
    expect(
      draft_to_cron(draft({ frequency: 'interval', interval_unit: 'minutes', interval_value: 10 })),
    ).toBe('*/10 * * * *');
    expect(
      draft_to_cron(
        draft({ frequency: 'interval', interval_unit: 'hours', interval_value: 3, minute: 15 }),
      ),
    ).toBe('15 */3 * * *');
    expect(
      draft_to_cron(
        draft({
          frequency: 'interval',
          interval_unit: 'days',
          interval_value: 2,
          hour: 8,
          minute: 30,
        }),
      ),
    ).toBe('30 8 */2 * *');
  });

  it('rejects interval values that cron cannot represent in the selected field', () => {
    expect(
      draft_to_cron(draft({ frequency: 'interval', interval_unit: 'minutes', interval_value: 60 })),
    ).toBeNull();
    expect(
      draft_to_cron(draft({ frequency: 'interval', interval_unit: 'hours', interval_value: 24 })),
    ).toBeNull();
    expect(
      draft_to_cron(draft({ frequency: 'interval', interval_unit: 'days', interval_value: 32 })),
    ).toBeNull();
  });

  it('builds weekly crons with a sorted day list', () => {
    const cron = draft_to_cron(
      draft({ frequency: 'weekly', hour: 14, minute: 0, weekdays: [5, 1, 3] }),
    );
    expect(cron).toBe('0 14 * * 1,3,5');
  });

  it('returns null for weekly with no day picked (keeps submit disabled)', () => {
    expect(draft_to_cron(draft({ frequency: 'weekly', weekdays: [] }))).toBeNull();
  });

  it('builds monthly crons on a day of month', () => {
    expect(
      draft_to_cron(draft({ frequency: 'monthly', hour: 8, minute: 0, day_of_month: 15 })),
    ).toBe('0 8 15 * *');
  });

  it('one-time: pins the cron to the picked month + day, null without a date', () => {
    expect(
      draft_to_cron(draft({ frequency: 'once', hour: 9, minute: 30, once_date: '2026-07-01' })),
    ).toBe('30 9 1 7 *');
    expect(draft_to_cron(draft({ frequency: 'once', once_date: '' }))).toBeNull();
  });
});

describe('draft_to_run_once_at', () => {
  it('returns an ISO instant for a one-time draft', () => {
    const at = draft_to_run_once_at(
      draft({ frequency: 'once', hour: 9, minute: 30, once_date: '2026-07-01' }),
    );
    expect(at).not.toBeNull();
    expect(Number.isNaN(Date.parse(at as string))).toBe(false);
  });

  it('returns null for recurring frequencies or a missing date', () => {
    expect(draft_to_run_once_at(draft({ frequency: 'daily' }))).toBeNull();
    expect(draft_to_run_once_at(draft({ frequency: 'once', once_date: '' }))).toBeNull();
  });
});

describe('cron_to_draft', () => {
  it('round-trips hourly / daily / weekly / monthly', () => {
    const cases: ScheduleDraft[] = [
      draft({ frequency: 'hourly', minute: 30 }),
      draft({ frequency: 'interval', interval_unit: 'minutes', interval_value: 10 }),
      draft({ frequency: 'interval', interval_unit: 'hours', interval_value: 3, minute: 15 }),
      draft({
        frequency: 'interval',
        interval_unit: 'days',
        interval_value: 2,
        hour: 8,
        minute: 30,
      }),
      draft({ frequency: 'daily', hour: 9, minute: 0 }),
      draft({ frequency: 'weekly', hour: 14, minute: 0, weekdays: [1, 3, 5] }),
      draft({ frequency: 'monthly', hour: 8, minute: 0, day_of_month: 15 }),
    ];
    for (const original of cases) {
      const cron = draft_to_cron(original);
      expect(cron).not.toBeNull();
      const parsed = cron_to_draft(cron as string);
      expect(parsed?.frequency).toBe(original.frequency);
      expect(parsed?.minute).toBe(original.minute);
      if (original.frequency === 'interval') {
        expect(parsed?.interval_unit).toBe(original.interval_unit);
        expect(parsed?.interval_value).toBe(original.interval_value);
      }
      if (original.frequency !== 'hourly') expect(parsed?.hour).toBe(original.hour);
      if (original.frequency === 'weekly') expect(parsed?.weekdays).toEqual(original.weekdays);
      if (original.frequency === 'monthly')
        expect(parsed?.day_of_month).toBe(original.day_of_month);
    }
  });

  it('returns null for crons the builder cannot represent', () => {
    expect(cron_to_draft('0 9 * 6 *')).toBeNull();
    expect(cron_to_draft('0 9 1 * 1')).toBeNull();
    expect(cron_to_draft('not a cron')).toBeNull();
    expect(cron_to_draft('0/5 * * * *')).toBeNull();
  });
});
