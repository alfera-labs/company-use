import { describe, expect, it } from 'vitest';
import type { AutomationFire } from '@/components/app/automations/automations_api';
import {
  describe_budget_pause,
  describe_fire_outcome,
  describe_skip,
} from '@/components/app/automations/fire_outcome_words';

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

describe('describe_fire_outcome', () => {
  const told = (fields: Record<string, unknown>) => ({
    notification_event_id: 'evt_n',
    title: 'Add the note?',
    outcome: 'notify_now',
    outcome_reason: 'it asks for a decision, which reaches you on When it matters',
    delivered_on: null,
    delivery_error: null,
    asks_the_person: true,
    open: true,
    ...fields,
  });

  it('says where it told you, in the place a person would name', () => {
    expect(describe_fire_outcome(fire({ told: told({ delivered_on: 'slack_dm' }) }))).toBe(
      'Told you on Slack',
    );
    expect(describe_fire_outcome(fire({ told: told({ delivered_on: 'chat' }) }))).toBe(
      'Told you in chat',
    );
    expect(describe_fire_outcome(fire({ told: told({ delivered_on: 'email' }) }))).toBe(
      'Told you by email',
    );
    expect(describe_fire_outcome(fire({ told: told({ delivered_on: 'web' }) }))).toBe(
      'Told you on this page',
    );
  });

  it("says a held message from the hold the API names, and the run's own words otherwise", () => {
    const held = (fields: Record<string, unknown>, summary_time?: string) =>
      describe_fire_outcome(
        fire({ told: told({ outcome: 'add_to_daily_summary', held: null, ...fields }) }),
        summary_time,
      );
    expect(
      held({ held: { kind: 'daily_cap', limit: 5 }, outcome_reason: 'anything at all' }, '08:30'),
    ).toBe("Saved for the 08:30 summary — held: today's 5 interruptions are spent");
    expect(held({ held: { kind: 'quiet_hours' }, outcome_reason: 'anything at all' })).toBe(
      'Saved for the daily summary — held for quiet hours',
    );
    expect(held({ outcome_reason: "today's 9 interruptions are spent" })).toBe(
      "Saved for the daily summary — today's 9 interruptions are spent",
    );
  });

  it('says the rest of the endings without making a person guess', () => {
    expect(describe_fire_outcome(fire({}))).toBe('Ran, nothing to tell you');
    expect(describe_fire_outcome(fire({ told: told({ delivery_error: 'Slack said no.' }) }))).toBe(
      'Could not reach you: Slack said no.',
    );
    expect(describe_fire_outcome(fire({ told: told({ outcome: 'add_to_ideas_list' }) }))).toBe(
      'Parked on Ideas',
    );
    expect(
      describe_fire_outcome(
        fire({
          told: told({ outcome: 'drop_with_reason', outcome_reason: 'A newsletter is not news.' }),
        }),
      ),
    ).toBe('Dropped: A newsletter is not news.');
    expect(describe_fire_outcome(fire({ outcome: 'waiting' }))).toBe('Waiting');
  });

  it('says a start that never became a run did not run, and why', () => {
    expect(
      describe_fire_outcome(fire({ outcome: 'didnt_fire', reason: 'The model call timed out.' })),
    ).toBe('Did not run: The model call timed out');
    expect(
      describe_fire_outcome(
        fire({ outcome: 'didnt_fire', reason: 'Paused by its budget.', budget_limit: 50 }),
      ),
    ).toBe('Did not run: hit 50 events today, so it paused');
    expect(describe_fire_outcome(fire({ outcome: 'didnt_fire', reason: null }))).toBe(
      'Did not run',
    );
  });
});

describe('describe_skip', () => {
  it('says each stage in plain words, never the stage name or a score', () => {
    expect(describe_skip({ stage: 'rule', reason: 'the sender is a no-reply' })).toBe(
      'Your checks said no: the sender is a no-reply',
    );
    expect(describe_skip({ stage: 'judge', reason: 'it reads like a newsletter' })).toBe(
      'Not a match: it reads like a newsletter',
    );
    expect(describe_skip({ stage: 'human', reason: 'The person sent this themselves.' })).toBe(
      'You took over the thread',
    );
    expect(describe_skip({ stage: 'listen', reason: 'Lead intake only listens.' })).toBe(
      'Only watching',
    );
    expect(describe_skip({ stage: 'judge', reason: '' })).toBe('Not a match');
  });

  it('reads the stage off the field, not off the reason sentence', () => {
    const said = describe_fire_outcome(
      fire({
        outcome: 'skipped',
        reason: 'judge 0.3: a mailing list',
        skipped: { stage: 'rule', reason: 'from is not any of a@example.com' },
      }),
    );
    expect(said).toBe('Your checks said no: from is not any of a@example.com');
  });
});

describe('describe_budget_pause', () => {
  it('reads the budget pause off the newest start, and nothing off any other one', () => {
    expect(describe_budget_pause(fire({ outcome: 'didnt_fire', budget_limit: 50 }))).toBe(
      'hit 50 events today',
    );
    expect(describe_budget_pause(fire({ outcome: 'fired' }))).toBeNull();
    expect(describe_budget_pause(undefined)).toBeNull();
  });
});

describe('a start written before the fields existed', () => {
  it('reads an old judge start off the cleaned field, never the one-line reason', () => {
    const said = describe_fire_outcome(
      fire({
        outcome: 'skipped',
        reason: 'judge 0.64: 0.64 < 0.7: jev p(yes)=0.64',
        skipped: { stage: 'judge', reason: 'The event does not fit the question.' },
      }),
    );
    expect(said).toBe('Not a match: The event does not fit the question.');
  });

  it('says only "Filtered" for a stage the API does not know, never its raw line', () => {
    const said = describe_fire_outcome(
      fire({ outcome: 'skipped', reason: 'budget: 40 signals today', skipped: null }),
    );
    expect(said).toBe('Filtered');
  });

  it('still reads a budget pause out of the sentence', () => {
    const over = fire({
      outcome: 'didnt_fire',
      reason: 'Automation Lead intake paused: it fired 51 times today, past its budget of 50',
    });
    expect(describe_budget_pause(over)).toBe('hit 50 events today');
    expect(describe_fire_outcome(over)).toBe('Did not run: hit 50 events today, so it paused');
  });
});
