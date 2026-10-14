import { describe, expect, it } from 'vitest';
import {
  editor_is_complete,
  editor_value_from,
  editor_value_to_update_body,
  empty_editor_value,
  is_dirty,
} from '@/components/app/automations/automation_editor_model';
import type {
  AutomationTrigger,
  AutomationWithTriggers,
} from '@/components/app/automations/automations_api';

function trigger(fields: Partial<AutomationTrigger>): AutomationTrigger {
  return {
    trigger_id: 'trg_1',
    trigger_name: 'Mail arrives',
    trigger_type: 'app_event',
    trigger_status: 'enabled',
    schedule_expression: null,
    trigger_config: {},
    last_run_time: null,
    created_time: '2026-09-01T09:00:00.000Z',
    ...fields,
  } as unknown as AutomationTrigger;
}

const automation = {
  automation_id: 'atm_1',
  automation_name: 'Answer billing questions',
  automation_status: 'enabled',
  instruction: 'Draft the credit note and a reply, put both in Drafts.',
  run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
  conditions: [{ field: 'from', operation: 'is_not_any_of', values: ['me@example.com'] }],
  judge: { question: 'Is this a customer asking about a refund?' },
  created_by: 'usr_1',
} as unknown as AutomationWithTriggers['automation'];

const mail_trigger = trigger({
  trigger_id: 'trg_mail',
  trigger_config: {
    event_source: {
      node_key: 'composio_gmail-new_gmail_message-1',
      connection_id: 'conn_1',
      subscription_config: { labelIds: 'INBOX' },
    },
    rules: [],
  },
});

const clock_trigger = trigger({
  trigger_id: 'trg_clock',
  trigger_type: 'schedule',
  schedule_expression: '0 8 * * 1-5',
  trigger_config: { timezone: 'Europe/London' },
});

const triggers = [mail_trigger, clock_trigger];

describe('editor_value_from', () => {
  it('reads an automation and its ears into one editable value', () => {
    const value = editor_value_from(automation, triggers);

    expect(value.name).toBe('Answer billing questions');
    expect(value.judge_question).toBe('Is this a customer asking about a refund?');
    expect(value.triggers.map((entry) => entry.key)).toEqual(['trg_mail', 'trg_clock']);
    expect(value.triggers[0]?.row?.trigger_id).toBe('trg_mail');
  });
});

describe('editor_value_to_update_body', () => {
  it('sends every ear back, not only the changed one', () => {
    const body = editor_value_to_update_body(editor_value_from(automation, triggers), undefined);

    expect(body.triggers).toEqual([
      {
        kind: 'app_event',
        node_key: 'composio_gmail-new_gmail_message-1',
        connection_id: 'conn_1',
        subscription_config: { labelIds: 'INBOX' },
        conditions: [],
      },
      { kind: 'schedule', cron: '0 8 * * 1-5', timezone: 'Europe/London' },
    ]);
  });

  it('carries the rules, the judge and the run policy through untouched', () => {
    const body = editor_value_to_update_body(editor_value_from(automation, triggers), undefined);

    expect(body).not.toHaveProperty('uses_tools');
    expect(body.conditions).toEqual([
      { field: 'from', operation: 'is_not_any_of', values: ['me@example.com'] },
    ]);
    expect(body.judge).toEqual({ question: 'Is this a customer asking about a refund?' });
    expect(body.run_policy).toEqual({
      ...automation.run_policy,
      budget: { max_fires_per_day: 50, max_no_progress_runs: 3 },
    });
  });

  it('round-trips the Limits boxes: read from run_policy.budget, written back into it', () => {
    const saved_budget = { max_fires_per_day: 12, max_no_progress_runs: 2 };
    const run_policy = { ...automation.run_policy, budget: saved_budget };
    const value = editor_value_from({ ...automation, run_policy }, triggers);

    expect(value.budget).toEqual({ max_fires_per_day: 12, max_no_progress_runs: 2 });

    const budget = { ...value.budget, max_fires_per_day: 7 };
    const body = editor_value_to_update_body({ ...value, budget }, undefined);
    expect(body.run_policy?.budget).toEqual({ max_fires_per_day: 7, max_no_progress_runs: 2 });
    expect(body.run_policy?.subject_from).toBe(automation.run_policy.subject_from);
  });

  it('reads the defaults when the saved policy has no budget', () => {
    const { budget } = editor_value_from(automation, triggers);
    expect(budget).toEqual({ max_fires_per_day: 50, max_no_progress_runs: 3 });
  });

  it('keeps the saved judge score when only the question changed', () => {
    const judge = { question: 'Is this a lead?', run_at_or_above: 80 };
    const value = editor_value_from({ ...automation, judge }, triggers);
    const edited = { ...value, judge_question: 'Is this a hot lead?' };
    const body = editor_value_to_update_body(edited, undefined);

    expect(body.judge).toEqual({ question: 'Is this a hot lead?', run_at_or_above: 80 });
  });

  it('sends no judge when the question was cleared', () => {
    const value = { ...editor_value_from(automation, triggers), judge_question: '   ' };

    expect(editor_value_to_update_body(value, undefined).judge).toBeNull();
  });

  it('drops a removed ear from the list it sends', () => {
    const value = editor_value_from(automation, triggers);
    const kept = value.triggers.filter((entry) => entry.key !== 'trg_clock');
    const body = editor_value_to_update_body({ ...value, triggers: kept }, undefined);

    expect(body.triggers).toHaveLength(1);
  });
});

describe('editor_is_complete', () => {
  it('refuses an automation that is missing a name, an instruction or a way to start', () => {
    const value = editor_value_from(automation, triggers);

    expect(editor_is_complete(value)).toBe(true);
    expect(editor_is_complete(empty_editor_value())).toBe(false);
    expect(editor_is_complete({ ...value, name: '  ' })).toBe(false);
    expect(editor_is_complete({ ...value, instruction: '' })).toBe(false);
    expect(editor_is_complete({ ...value, triggers: [] })).toBe(false);
  });

  it('refuses an Only-if check that names no field', () => {
    const value = editor_value_from(automation, triggers);
    const empty_check = { field: '', operation: 'equals_any_of' as const, values: [] };

    expect(editor_is_complete({ ...value, rules: [...value.rules, empty_check] })).toBe(false);
  });
});

describe('is_dirty', () => {
  const saved = editor_value_from(automation, triggers);

  it('says nothing changed when the page was only reloaded', () => {
    expect(is_dirty(saved, editor_value_from(automation, triggers))).toBe(false);
  });

  it('notices a retyped instruction and a removed trigger', () => {
    expect(is_dirty(saved, { ...saved, instruction: 'Something else.' })).toBe(true);
    expect(is_dirty(saved, { ...saved, triggers: saved.triggers.slice(0, 1) })).toBe(true);
  });

  it('ignores a trigger row that moved without anybody editing it', () => {
    const later = editor_value_from(automation, [
      { ...mail_trigger, last_run_time: '2026-09-16T09:00:00.000Z' } as AutomationTrigger,
      clock_trigger,
    ]);

    expect(is_dirty(saved, later)).toBe(false);
  });
});
