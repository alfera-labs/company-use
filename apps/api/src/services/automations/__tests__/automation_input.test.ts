import { update_automation_input_schema } from '@api/services/automations/automation_input';
import { describe, expect, it } from 'vitest';

const identity = { workspace_id: 'ws_1', automation_id: 'atm_1', actor_id: 'user_1' };

describe('update_automation_input_schema', () => {
  it('accepts a run policy carrying a budget', () => {
    const parsed = update_automation_input_schema.parse({
      ...identity,
      run_policy: {
        subject_from: 'thread_id',
        when_a_run_is_already_going: 'wait_for_it_to_finish',
        budget: { max_fires_per_day: 7, max_no_progress_runs: 2 },
      },
    });

    expect(parsed.run_policy).toEqual({
      subject_from: 'thread_id',
      when_a_run_is_already_going: 'wait_for_it_to_finish',
      budget: { max_fires_per_day: 7, max_no_progress_runs: 2 },
    });
  });

  it('fills the budget defaults when only one ceiling is sent', () => {
    const parsed = update_automation_input_schema.parse({
      ...identity,
      run_policy: {
        subject_from: null,
        when_a_run_is_already_going: 'wait_for_it_to_finish',
        budget: { max_fires_per_day: 12 },
      },
    });

    expect(parsed.run_policy?.budget).toEqual({ max_fires_per_day: 12, max_no_progress_runs: 3 });
  });

  it('refuses a policy sent without subject_from, so a budget edit cannot drop it', () => {
    const parsed = update_automation_input_schema.safeParse({
      ...identity,
      run_policy: { budget: { max_fires_per_day: 7 } },
    });

    expect(parsed.success).toBe(false);
  });
});
