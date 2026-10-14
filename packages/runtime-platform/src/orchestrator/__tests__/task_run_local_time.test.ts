import { format_current_turn_context } from '@runtime-platform/orchestrator/context/current_turn_context';
import { build_model_visible_current_turn_context } from '@runtime-platform/orchestrator/current_turn_context';
import { afterEach, describe, expect, it, vi } from 'vitest';

const task_turn = { session_id: 'ses_task', source_type: 'runtime' as const };
const in_time_zone = (local_timezone: string) => ({
  ...task_turn,
  user_message_source_metadata: { local_timezone },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the local time in a run nobody is present in', () => {
  it('is told to the model in the time zone of the scheduled task', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T17:35:15.000Z'));

    const text = format_current_turn_context(
      build_model_visible_current_turn_context(in_time_zone('Europe/Rome')),
    );

    expect(text).toMatch(/^local_time: Monday, October 12, 2026.* 19:35 \(Europe\/Rome\)$/mu);
    expect(text).toContain('Use this wall-clock time for any date or time answer, not UTC.');
    expect(text).toContain('No user is present in this run.');
  });

  it('leaves the context as it was for a run with no time zone', () => {
    const text = format_current_turn_context(build_model_visible_current_turn_context(task_turn));

    expect(text).not.toContain('local_time');
    expect(text).not.toContain('wall-clock');
    expect(text).toContain('No user is present in this run.');
  });

  it('tells nothing for a time zone that does not exist', () => {
    const text = format_current_turn_context(
      build_model_visible_current_turn_context(in_time_zone('Mars/Olympus')),
    );

    expect(text).not.toContain('local_time');
  });
});
