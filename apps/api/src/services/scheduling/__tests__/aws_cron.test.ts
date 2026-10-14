import { to_aws_schedule_expression } from '@api/services/scheduling/adapters/aws_cron';
import type { TriggerSchedule } from '@coworker/runtime-platform';
import { describe, expect, it } from 'vitest';

function schedule(patch: Partial<TriggerSchedule>): TriggerSchedule {
  return { trigger_id: 'trg_1', cron_expression: '0 9 * * *', ...patch };
}

describe('to_aws_schedule_expression — recurring', () => {
  it('daily: wildcards both day fields -> DOM "*", DOW "?"', () => {
    expect(to_aws_schedule_expression(schedule({ cron_expression: '0 9 * * *' }))).toEqual({
      expression: 'cron(0 9 * * ? *)',
    });
  });

  it('monthly: a day-of-month, DOW becomes "?"', () => {
    expect(to_aws_schedule_expression(schedule({ cron_expression: '0 9 15 * *' }))).toEqual({
      expression: 'cron(0 9 15 * ? *)',
    });
  });

  it('weekly: remaps Unix day-of-week (0–6, 0=Sun) to AWS (1–7, 1=Sun) and sets DOM "?"', () => {
    expect(to_aws_schedule_expression(schedule({ cron_expression: '0 9 * * 1,3,5' }))).toEqual({
      expression: 'cron(0 9 ? * 2,4,6 *)',
    });
    expect(to_aws_schedule_expression(schedule({ cron_expression: '0 9 * * 0' }))).toEqual({
      expression: 'cron(0 9 ? * 1 *)',
    });
    expect(to_aws_schedule_expression(schedule({ cron_expression: '0 9 * * 6' }))).toEqual({
      expression: 'cron(0 9 ? * 7 *)',
    });
  });

  it('weekly range: remaps each end of the range', () => {
    expect(to_aws_schedule_expression(schedule({ cron_expression: '0 9 * * 1-5' }))).toEqual({
      expression: 'cron(0 9 ? * 2-6 *)',
    });
  });

  it('translates the weekday scout cadence', () => {
    expect(
      to_aws_schedule_expression(schedule({ cron_expression: '1 8,11,14,17 * * 1-5' })),
    ).toEqual({
      expression: 'cron(1 8,11,14,17 ? * 2-6 *)',
    });
  });

  it('passes the timezone through for recurring schedules', () => {
    expect(
      to_aws_schedule_expression(
        schedule({ cron_expression: '0 9 * * *', timezone: 'Europe/Rome' }),
      ),
    ).toEqual({ expression: 'cron(0 9 * * ? *)', timezone: 'Europe/Rome' });
  });

  it('rejects a cron constraining BOTH day-of-month and day-of-week (AWS cannot AND them)', () => {
    expect(() => to_aws_schedule_expression(schedule({ cron_expression: '0 9 15 * 1' }))).toThrow(
      /both day-of-month and day-of-week/,
    );
  });

  it('rejects a non-5-field cron', () => {
    expect(() => to_aws_schedule_expression(schedule({ cron_expression: '0 9 * *' }))).toThrow(
      /5-field cron/,
    );
  });
});

describe('to_aws_schedule_expression — one-time', () => {
  it('emits at(UTC wall-clock) with no zone suffix', () => {
    expect(
      to_aws_schedule_expression(schedule({ run_once_at: '2026-07-01T13:00:00.000Z' })),
    ).toEqual({ expression: 'at(2026-07-01T13:00:00)' });
  });

  it('normalizes an offset timestamp to UTC', () => {
    expect(
      to_aws_schedule_expression(schedule({ run_once_at: '2026-07-01T13:00:00+02:00' })),
    ).toEqual({ expression: 'at(2026-07-01T11:00:00)' });
  });

  it('run_once_at takes precedence over the cron expression', () => {
    const result = to_aws_schedule_expression(
      schedule({ cron_expression: '0 9 * * *', run_once_at: '2026-07-01T13:00:00Z' }),
    );
    expect(result.expression).toBe('at(2026-07-01T13:00:00)');
  });

  it('throws on an invalid one-time timestamp', () => {
    expect(() => to_aws_schedule_expression(schedule({ run_once_at: 'not-a-date' }))).toThrow(
      /Invalid one-time timestamp/,
    );
  });
});
