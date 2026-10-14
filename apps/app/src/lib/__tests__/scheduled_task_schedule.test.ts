import { describe, expect, it } from 'vitest';
import { describe_schedule, is_valid_cron } from '@/lib/scheduled_task_schedule';

describe('describe_schedule', () => {
  it('returns No schedule for empty / null / undefined', () => {
    expect(describe_schedule(null)).toBe('No schedule');
    expect(describe_schedule(undefined)).toBe('No schedule');
    expect(describe_schedule('')).toBe('No schedule');
  });

  it('renders a known preset cron as its friendly label', () => {
    expect(describe_schedule('0 9 * * *')).toBe('Every day at 9:00');
    expect(describe_schedule('0 9 * * 1-5')).toBe('Every weekday at 9:00');
    expect(describe_schedule('0 * * * *')).toBe('Every hour');
    expect(describe_schedule('0 9 * * 1')).toBe('Every Monday at 9:00');
  });

  it('trims surrounding whitespace before matching a preset', () => {
    expect(describe_schedule('  0 9 * * *  ')).toBe('Every day at 9:00');
  });

  it('describes a non-preset daily time as Every day at HH:MM', () => {
    expect(describe_schedule('30 14 * * *')).toBe('Every day at 14:30');
    expect(describe_schedule('5 7 * * *')).toBe('Every day at 7:05');
  });

  it('renders every hour of the day on a 24-hour clock', () => {
    expect(describe_schedule('0 0 * * *')).toBe('Every day at 0:00');
    expect(describe_schedule('0 12 * * *')).toBe('Every day at 12:00');
    expect(describe_schedule('0 23 * * *')).toBe('Every day at 23:00');
  });

  it('does NOT format out-of-range fields as a time — falls back to raw cron', () => {
    expect(describe_schedule('0 24 * * *')).toBe('Cron: 0 24 * * *');
    expect(describe_schedule('60 9 * * *')).toBe('Cron: 60 9 * * *');
    expect(describe_schedule('0 99 * * *')).toBe('Cron: 0 99 * * *');
  });

  it('falls back to the raw cron when the shape is not recognized', () => {
    expect(describe_schedule('15 9 * * 1-5')).toBe('Cron: 15 9 * * 1-5');
    expect(describe_schedule('not-a-cron')).toBe('Cron: not-a-cron');
  });

  it('describes schedules from the visual builder', () => {
    expect(describe_schedule('0 9 1 * *')).toBe('Every month on day 1 at 9:00');
    expect(describe_schedule('30 8 * * 2,4')).toBe('Every Tuesday, Thursday at 8:30');
    expect(describe_schedule('*/15 * * * *')).toBe('Every 15 minutes');
  });

  it('treats whitespace-only as No schedule', () => {
    expect(describe_schedule('   ')).toBe('No schedule');
  });
});

describe('is_valid_cron', () => {
  it('accepts well-formed 5-field crons', () => {
    expect(is_valid_cron('0 9 * * *')).toBe(true);
    expect(is_valid_cron('0 9 * * 1-5')).toBe(true);
    expect(is_valid_cron('*/15 * * * *')).toBe(true);
    expect(is_valid_cron('0 9,17 * * 1,3,5')).toBe(true);
  });

  it('rejects wrong field counts and garbage', () => {
    expect(is_valid_cron('0 9 * *')).toBe(false);
    expect(is_valid_cron('0 9 * * * *')).toBe(false);
    expect(is_valid_cron('not a cron')).toBe(false);
    expect(is_valid_cron('')).toBe(false);
    expect(is_valid_cron('@daily')).toBe(false);
  });

  it('rejects numerically out-of-range and malformed fields', () => {
    expect(is_valid_cron('99 99 99 99 99')).toBe(false);
    expect(is_valid_cron('60 9 * * *')).toBe(false);
    expect(is_valid_cron('0 24 * * *')).toBe(false);
    expect(is_valid_cron('0 9 32 * *')).toBe(false);
    expect(is_valid_cron('0 9 * 13 *')).toBe(false);
    expect(is_valid_cron('10-5 * * * *')).toBe(false);
    expect(is_valid_cron('*/0 * * * *')).toBe(false);
    expect(is_valid_cron('*/1.5 * * * *')).toBe(false);
    expect(is_valid_cron('*/2/3 * * * *')).toBe(false);
    expect(is_valid_cron('1,,2 * * * *')).toBe(false);
    expect(is_valid_cron('1- * * * *')).toBe(false);
    expect(is_valid_cron('0x10 * * * *')).toBe(false);
    expect(is_valid_cron('1e1 * * * *')).toBe(false);
  });

  it('accepts in-range ranges, lists, and steps', () => {
    expect(is_valid_cron('0-30/5 8-17 1-15 1-6 0-6')).toBe(true);
    expect(is_valid_cron('0 0 1 1 0')).toBe(true);
    expect(is_valid_cron('59 23 31 12 7')).toBe(true);
  });
});
