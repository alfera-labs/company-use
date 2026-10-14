import {
  ask_is_already_automated,
  group_recurring_asks,
  type HumanAsk,
  iso_week_key,
  normalize_ask,
} from '@runtime-platform/miner/group_recurring_asks';
import { describe, expect, it } from 'vitest';

function ask(ask_text: string, day: string, run_id = `run_${day}`): HumanAsk {
  return { run_id, session_id: 'ses_1', ask_text, occurred_at: new Date(`${day}T10:00:00Z`) };
}

describe('normalize_ask', () => {
  it('drops the date, the number and the name, and keeps the work', () => {
    const first = normalize_ask(
      'Pull the weekly lead list for Morgan and post 12 of them to sales on Friday',
    );
    const second = normalize_ask(
      'Pull the weekly lead list for Alex and post 20 of them to sales on Monday',
    );

    expect(first).toBe(second);
    expect(first).toContain('lead');
    expect(first).not.toContain('morgan');
    expect(first).not.toContain('friday');
    expect(first).not.toContain('12');
  });

  it('keeps two different jobs apart', () => {
    expect(normalize_ask('send the investor update')).not.toBe(
      normalize_ask('book the meeting room'),
    );
  });
});

describe('iso_week_key', () => {
  it('counts a week, not a day', () => {
    expect(iso_week_key(new Date('2026-09-14T00:00:00Z'))).toBe(
      iso_week_key(new Date('2026-09-18T23:00:00Z')),
    );
    expect(iso_week_key(new Date('2026-09-14T00:00:00Z'))).not.toBe(
      iso_week_key(new Date('2026-09-21T00:00:00Z')),
    );
  });
});

describe('group_recurring_asks', () => {
  const three_weeks = [
    ask('Pull the weekly lead list and post it to sales', '2026-09-04'),
    ask('Pull the weekly lead list and post it to sales', '2026-09-11'),
    ask('Pull the weekly lead list and post it to sales', '2026-09-18'),
  ];

  it('passes an ask made three times over three weeks', () => {
    const [candidate, ...rest] = group_recurring_asks(three_weeks);

    expect(rest).toHaveLength(0);
    expect(candidate?.ask_count).toBe(3);
    expect(candidate?.distinct_weeks).toBe(3);
    expect(candidate?.run_ids).toHaveLength(3);
    expect(candidate?.ask_key).toHaveLength(32);
  });

  it('refuses two asks, and three asks inside one week', () => {
    expect(group_recurring_asks(three_weeks.slice(0, 2))).toEqual([]);
    expect(
      group_recurring_asks([
        ask('Pull the weekly lead list and post it to sales', '2026-09-14', 'run_a'),
        ask('Pull the weekly lead list and post it to sales', '2026-09-15', 'run_b'),
        ask('Pull the weekly lead list and post it to sales', '2026-09-16', 'run_c'),
      ]),
    ).toEqual([]);
  });

  it('groups the same job written three different ways', () => {
    const candidates = group_recurring_asks([
      ask('Pull the weekly lead list for Riley and post it to sales, 30', '2026-09-04'),
      ask('pull the weekly lead list and post it to sales tomorrow', '2026-09-11'),
      ask('Please pull the weekly lead list again and post it to sales on the 18th', '2026-09-18'),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.ask_count).toBe(3);
  });

  it('never groups a greeting, whose words all fall away', () => {
    expect(
      group_recurring_asks([
        ask('hi', '2026-09-04'),
        ask('hi', '2026-09-11'),
        ask('hi', '2026-09-18'),
      ]),
    ).toEqual([]);
  });
});

describe('ask_is_already_automated', () => {
  const normalized = normalize_ask('Pull the weekly lead list and post it to sales');

  it('recognises the automation they already have', () => {
    expect(
      ask_is_already_automated(normalized, [
        'Every Friday, pull the weekly lead list and post it to sales.',
      ]),
    ).toBe(true);
  });

  it('does not call a different job coverage', () => {
    expect(
      ask_is_already_automated(normalized, ['Every morning, summarise the inbox and email me.']),
    ).toBe(false);
  });
});
