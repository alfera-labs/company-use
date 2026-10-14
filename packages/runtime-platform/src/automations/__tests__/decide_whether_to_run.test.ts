import type { Database } from '@coworker/core';
import type { AutomationJudge } from '@coworker/core/db/schema/automation_contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replies: unknown[] = [];
const generate_object = vi.fn(async (input: { parse?: (value: unknown) => unknown }) => {
  const reply = replies.shift();
  if (typeof reply === 'string') throw new Error(`LLM response was not valid JSON: ${reply}`);
  return { object: input.parse ? input.parse(reply) : reply, text: '', result: {} };
});
vi.mock('@agent-core/llm_gateway', () => ({ create_llm_gateway: () => ({ generate_object }) }));
const dial = { value: 'normal' };
vi.mock('@runtime-platform/notifications/notification_rules_file', () => ({
  read_notification_rules_file: async () => ({ policy: { dial: dial.value } }),
}));

const { decide_whether_to_run } = await import(
  '@runtime-platform/automations/decide_whether_to_run'
);

const db = {} as Database;
const judge: AutomationJudge = {
  question: 'Is this a customer asking about an invoice?',
  run_at_or_above: 0.8,
};
const judge_without_a_threshold: AutomationJudge = {
  question: 'Is this a customer asking about an invoice?',
};
const email = { sender: 'Dana <dana@example.com>', subject: 'Question about invoice 1042' };

function ask(its_judge: AutomationJudge = judge) {
  return decide_whether_to_run(db, {
    workspace_id: 'ws_1',
    agent_id: 'agt_1',
    conditions: [],
    judge: its_judge,
    data: email,
  });
}

describe('decide_whether_to_run', () => {
  beforeEach(() => {
    replies.length = 0;
    generate_object.mockClear();
    dial.value = 'normal';
  });

  it('still runs when the dial is off, because off is about contact and not about work', async () => {
    dial.value = 'off';
    replies.push({ kind: 'inquiry', confidence: 0.94, reason: 'asks about fees' });

    const decision = await ask(judge_without_a_threshold);

    expect(decision.runs).toBe(true);
    expect(decision.skipped).toBeUndefined();
  });

  it('takes the judge threshold from the dial when the automation names none', async () => {
    dial.value = 'quiet';
    replies.push({ kind: 'inquiry', confidence: 0.85, reason: 'asks about fees' });

    const decision = await ask(judge_without_a_threshold);

    expect(decision.runs).toBe(false);
    expect(decision.skipped).toMatchObject({
      stage: 'judge',
      reason: 'Likely, but not sure enough to run.',
    });
    expect(decision.verdict).toMatchObject({ confidence: 0.85, threshold: 0.9 });
  });

  it('fails OPEN when the judge cannot be read twice: the run happens, the verdict says why', async () => {
    replies.push('Yes', 'still not JSON');

    const decision = await ask();

    expect(decision.runs).toBe(true);
    expect(decision.skipped).toBeUndefined();
    expect(decision.verdict).toMatchObject({ confidence: null, kind: 'unknown' });
    expect(decision.verdict?.reason).toContain('judge unavailable');
  });

  it('says a yes below the bar was not sure enough, never the reason for yes', async () => {
    replies.push({ answer: 'yes', confidence: 0.7, reason: 'The event fits the question.' });

    const decision = await ask();

    expect(decision.runs).toBe(false);
    expect(decision.skipped).toEqual({
      stage: 'judge',
      reason: 'Likely, but not sure enough to run.',
    });
    expect(decision.verdict).toMatchObject({ answer: 'yes', confidence: 0.7, threshold: 0.8 });
  });

  it("keeps the judge's own words when it answered no", async () => {
    replies.push({ answer: 'no', confidence: 0.9, reason: 'The event does not fit the question.' });

    const decision = await ask();

    expect(decision.runs).toBe(false);
    expect(decision.skipped).toEqual({
      stage: 'judge',
      reason: 'The event does not fit the question.',
    });
    expect(decision.verdict).toMatchObject({ answer: 'no', threshold: 0.8 });
  });

  it('still turns away a confident no', async () => {
    replies.push({ kind: 'newsletter', confidence: 0.05, reason: 'a marketing blast' });

    const decision = await ask();

    expect(decision.runs).toBe(false);
    expect(decision.skipped?.stage).toBe('judge');
  });
});

describe('the bar written as 0-100', () => {
  it('lets a sure yes through a bar of 85', async () => {
    replies.push({ kind: 'inquiry', confidence: 1, reason: 'asks for a demo' });
    const decision = await ask({ question: 'Demo?', run_at_or_above: 85 });
    expect(decision.runs).toBe(true);
  });

  it('still stops a weak yes below that bar', async () => {
    replies.push({ kind: 'inquiry', confidence: 0.6, reason: 'maybe' });
    const decision = await ask({ question: 'Demo?', run_at_or_above: 85 });
    expect(decision.runs).toBe(false);
  });
});

describe('a judge that cannot answer', () => {
  beforeEach(() => {
    replies.length = 0;
    generate_object.mockClear();
    dial.value = 'normal';
  });

  it('lets the run happen even at the strictest bar, and the verdict names no threshold', async () => {
    dial.value = 'quiet';
    replies.push('not JSON', 'still not JSON');

    const decision = await ask({ question: 'Is this an invoice?', run_at_or_above: 1 });

    expect(decision.runs).toBe(true);
    expect(decision.skipped).toBeUndefined();
    expect(decision.verdict).toMatchObject({ confidence: null, answer: null, threshold: null });
    expect(generate_object).toHaveBeenCalledTimes(2);
  });

  it('still stops the event at a rule before any judge is asked', async () => {
    replies.push('not JSON', 'still not JSON');

    const decision = await decide_whether_to_run(db, {
      workspace_id: 'ws_1',
      agent_id: 'agt_1',
      conditions: [{ field: 'subject', operation: 'contains_any_of', values: ['invoice'] }],
      judge: { question: 'Is this an invoice?' },
      data: { subject: 'Lunch on Friday' },
    });

    expect(decision.runs).toBe(false);
    expect(decision.skipped?.stage).toBe('rule');
    expect(generate_object).not.toHaveBeenCalled();
  });

  it('neither runs nor skips when the model provider fails: the error goes up and the job retries', async () => {
    generate_object.mockRejectedValueOnce(new Error('429 rate limited'));

    await expect(ask()).rejects.toThrow('429 rate limited');
  });
});
