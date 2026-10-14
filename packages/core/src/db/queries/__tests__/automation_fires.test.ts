import { read_automation_fire } from '@coworker/core/db/queries/automation_fire_reading';
import { describe, expect, it } from 'vitest';

const row = {
  event_id: 'evt_1',
  fired_time: new Date('2026-09-16T09:00:00Z'),
  trigger_id: 'trg_1',
  trigger_name: 'Notion page created',
  job_status: 'done',
  error_data: null,
  run_id: null,
};

describe('read_automation_fire', () => {
  it('says which field the conversation was keyed by, fallbacks included', () => {
    expect(
      read_automation_fire({
        ...row,
        result_data: { ran: true, session_id: 'ses_1', subject_source: 'fallback:id' },
      }),
    ).toMatchObject({ outcome: 'fired', subject_source: 'fallback:id' });

    expect(
      read_automation_fire({
        ...row,
        result_data: { ran: true, session_id: 'ses_1', subject_source: 'node' },
      }).subject_source,
    ).toBe('node');
  });

  it('carries the source on a fire that was turned away too', () => {
    const fire = read_automation_fire({
      ...row,
      result_data: {
        ran: false,
        subject_source: 'occurrence',
        skipped: { stage: 'ear_rule', reason: 'title is absent' },
      },
    });
    expect(fire).toMatchObject({ outcome: 'skipped', subject_source: 'occurrence' });
    expect(fire.reason).toBe('ear_rule: title is absent');
    expect(fire.skipped).toEqual({ stage: 'rule', reason: 'title is absent' });
  });

  it('is null for a fire that never got as far as choosing one', () => {
    expect(
      read_automation_fire({ ...row, job_status: null, result_data: null }).subject_source,
    ).toBe(null);
  });

  it('carries a skip as fields: the stage, the judge words, and the numbers apart', () => {
    const fire = read_automation_fire({
      ...row,
      result_data: {
        ran: false,
        skipped: { stage: 'judge', reason: 'Likely, but not sure enough to run.' },
        judge: { answer: 'yes', confidence: 0.7, threshold: 0.8, reason: 'fits' },
      },
    });
    expect(fire).toMatchObject({
      outcome: 'skipped',
      reason: 'judge 0.7: Likely, but not sure enough to run.',
      skipped: { stage: 'judge', reason: 'Likely, but not sure enough to run.' },
      judge: { confidence: 0.7, threshold: 0.8 },
      budget_limit: null,
    });
  });

  it('takes the judge arithmetic out of the words of an older skip', () => {
    const skip_reason = (reason: string) =>
      read_automation_fire({
        ...row,
        result_data: { ran: false, skipped: { stage: 'judge', reason } },
      }).skipped?.reason;
    expect(skip_reason('30 < 60: it reads like a newsletter')).toBe('it reads like a newsletter');
    expect(skip_reason('0.64 < 0.7: jev p(yes)=0.64')).toBe('The event does not fit the question.');
    expect(skip_reason('Likely, but not sure enough to run.')).toBe(
      'Likely, but not sure enough to run.',
    );
  });

  it('has no judge numbers for a verdict written before the bar was recorded', () => {
    const fire = read_automation_fire({
      ...row,
      result_data: {
        ran: false,
        skipped: { stage: 'judge', reason: 'x' },
        judge: { confidence: 0.3 },
      },
    });
    expect(fire.judge).toBe(null);
  });

  it('carries the budget a pause hit as a number, not a sentence to parse', () => {
    const fire = read_automation_fire({
      ...row,
      result_data: {
        ran: false,
        code: 'automation_over_budget',
        message: 'Automation Lead intake paused: it fired 51 times today, past its budget of 50',
        budget_limit: 50,
      },
    });
    expect(fire).toMatchObject({ outcome: 'didnt_fire', budget_limit: 50, skipped: null });
  });
});
