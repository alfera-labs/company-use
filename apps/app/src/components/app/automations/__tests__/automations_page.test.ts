import { describe, expect, it } from 'vitest';
import { is_standalone_scheduled_task } from '@/components/app/automations/scheduled_task_rows';
import type { Trigger } from '@/lib/api';

const schedule = {
  trigger_id: 'trg_1',
  automation_id: null,
  trigger_type: 'schedule',
  created_by: 'user_1',
  trigger_source: null,
} as unknown as Trigger;

describe('the scheduled tasks under the automations', () => {
  it("shows a person's own schedule", () => {
    expect(is_standalone_scheduled_task(schedule)).toBe(true);
  });

  it("hides Alfera's own housekeeping schedules", () => {
    const tick = {
      ...schedule,
      created_by: 'system:trigger_reconcile',
      trigger_source: { kind: 'system', purpose: 'attention_tick' },
    } as unknown as Trigger;
    expect(is_standalone_scheduled_task(tick)).toBe(false);
  });
});
