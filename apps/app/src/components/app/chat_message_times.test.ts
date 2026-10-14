import { describe, expect, it } from 'vitest';
import {
  clock_time_label,
  day_separator_label,
  is_new_day,
} from '@/components/app/chat_message_times';

function local_time(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

describe('day_separator_label', () => {
  const now = new Date(2026, 8, 9, 15, 0).getTime();

  it('names today and yesterday in words', () => {
    expect(day_separator_label(local_time(2026, 9, 9, 8), now)).toBe('Today');
    expect(day_separator_label(local_time(2026, 9, 8, 23, 30), now)).toBe('Yesterday');
  });

  it('counts calendar days, not elapsed hours', () => {
    expect(day_separator_label(local_time(2026, 9, 9, 0, 1), now)).toBe('Today');
    expect(day_separator_label(local_time(2026, 9, 8, 14, 59), now)).toBe('Yesterday');
  });

  it('drops the year within this year and keeps it beyond', () => {
    const this_year = day_separator_label(local_time(2026, 8, 27), now);
    const other_year = day_separator_label(local_time(2025, 8, 27), now);

    expect(this_year).not.toContain('2026');
    expect(this_year).toContain('27');
    expect(other_year).toContain('2025');
  });
});

describe('is_new_day', () => {
  it('opens a day for the first dated message', () => {
    expect(is_new_day(undefined, local_time(2026, 9, 9))).toBe(true);
  });

  it('opens no day for the second message of the same day', () => {
    expect(is_new_day(local_time(2026, 9, 9, 8), local_time(2026, 9, 9, 22))).toBe(false);
  });

  it('opens a day when the calendar day changes', () => {
    expect(is_new_day(local_time(2026, 9, 8, 23, 59), local_time(2026, 9, 9, 0, 1))).toBe(true);
  });

  it('says nothing about a message with no time', () => {
    expect(is_new_day(local_time(2026, 9, 9), undefined)).toBe(false);
    expect(is_new_day(undefined, undefined)).toBe(false);
    expect(is_new_day(undefined, 'not a time')).toBe(false);
  });
});

describe('clock_time_label', () => {
  it('reads the hour and minute of the message', () => {
    const label = clock_time_label(local_time(2026, 9, 9, 20, 34));

    expect(label).toContain('34');
    expect(label).toMatch(/\b(8|20)\b/u);
  });
});
