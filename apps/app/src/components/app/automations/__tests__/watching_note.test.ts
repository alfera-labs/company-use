import { describe, expect, it } from 'vitest';
import type { AutomationFire } from '@/components/app/automations/automations_api';
import { find_unanswered_question } from '@/components/app/automations/watching_note';

function fire(event_id: string, told: Partial<NonNullable<AutomationFire['told']>> | null) {
  return {
    event_id,
    outcome: 'fired',
    told: told && { asks_the_person: false, open: false, ...told },
  } as unknown as AutomationFire;
}

describe('find_unanswered_question', () => {
  it('finds the newest open question even when a later start asked nothing', () => {
    const fires = [
      fire('evt_latest', null),
      fire('evt_told', { asks_the_person: false, open: true }),
      fire('evt_question', { asks_the_person: true, open: true }),
      fire('evt_older_question', { asks_the_person: true, open: true }),
    ];
    expect(find_unanswered_question(fires)?.event_id).toBe('evt_question');
  });

  it('finds nothing once every question has been answered', () => {
    expect(find_unanswered_question([fire('evt_q', { asks_the_person: true, open: false })])).toBe(
      null,
    );
  });
});
