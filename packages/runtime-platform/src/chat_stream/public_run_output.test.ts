import { AppError, ConflictError, NotFoundError } from '@coworker/shared';
import {
  public_run_failure_message,
  public_run_stream_error,
  session_busy_message,
} from '@runtime-platform/chat_stream/public_run_output';
import {
  public_tool_call,
  redact_skill_tool_call,
} from '@runtime-platform/chat_stream/public_session_reads';
import { describe, expect, it } from 'vitest';

describe('public_run_stream_error', () => {
  it('says the session is busy instead of claiming the run failed', () => {
    expect(
      public_run_stream_error(new ConflictError('Session already has an active runtime run')),
    ).toEqual({ code: 'session_busy', message: session_busy_message });
  });

  it('lets a billing refusal through with its code, so the chat can raise the paywall', () => {
    for (const code of ['card_required', 'out_of_credits']) {
      expect(public_run_stream_error(new AppError(code, 'Add a card to keep going', 402))).toEqual({
        code,
        message: 'Add a card to keep going',
      });
    }
  });

  it('still scrubs every other failure down to the generic message', () => {
    for (const error of [new Error('ECONNREFUSED 10.0.0.4:5432'), new NotFoundError('Session')]) {
      expect(public_run_stream_error(error)).toEqual({
        code: 'stream_error',
        message: public_run_failure_message,
      });
    }
  });
});

describe('redact_skill_tool_call', () => {
  const base = {
    output_text: null,
    workspace_id: 'ws',
    agent_id: null,
    node_id: null,
    connection_id: null,
    node_version: null,
    risk_class: null,
    approval_mode: null,
    error_code: null,
    finished_time: null,
    metadata: null,
    created_by: 'u',
    last_updated_time: null,
    last_updated_by: 'u',
  };

  it('hides a skill file read but keeps which file it was', () => {
    const redacted = redact_skill_tool_call({
      ...base,
      tool_name: 'workspace-read_file',
      input_data: { path: 'skills/weekly-ordering/rules.md' },
      output_data: { content: 'always exclude drafts; VIP discount is 15%' },
    });

    expect(JSON.stringify(redacted)).not.toContain('VIP discount');
    expect(redacted.input_data).toMatchObject({ path: 'skills/weekly-ordering/rules.md' });
    expect(redacted.output_text).toContain('weekly-ordering');
  });

  it('hides a skill write, including the text inside the command or edit', () => {
    const redacted = redact_skill_tool_call({
      ...base,
      tool_name: 'workspace-run_command',
      input_data: { command: "cat 'skills/pricing/rules.md' && echo secret-method" },
      output_data: { stdout: 'secret-method' },
    });

    expect(JSON.stringify(redacted)).not.toContain('secret-method');
  });

  it('catches a grep whose input never names the folder but whose output does', () => {
    const redacted = redact_skill_tool_call({
      ...base,
      tool_name: 'workspace-grep',
      input_data: { pattern: 'discount' },
      output_data: { matches: ['skills/pricing/rules.md:3: VIP discount is 15%'] },
    });

    expect(JSON.stringify(redacted)).not.toContain('15%');
    expect(JSON.stringify(redacted)).toContain('pricing');
  });

  it('hides the rule a save_procedure_rule call carries, keeping procedure and key', () => {
    const redacted = redact_skill_tool_call({
      ...base,
      tool_name: 'runtime-save_procedure_rule-1',
      input_data: {
        procedure: 'weekly-ordering',
        rule_key: 'discount_percent',
        rule: 'VIP is 15%',
      },
      output_data: { saved: true },
    });

    expect(JSON.stringify(redacted)).not.toContain('15%');
    expect(redacted.input_data).toMatchObject({ procedure: 'weekly-ordering' });
  });

  it('catches the absolute spelling a sandbox file tool uses', () => {
    const redacted = redact_skill_tool_call({
      ...base,
      tool_name: 'workspace-read_file',
      input_data: { path: '/workspace/skills/weekly-ordering/rules.md' },
      output_data: { content: 'VIP discount is 15%' },
    });

    expect(JSON.stringify(redacted)).not.toContain('15%');
    expect(JSON.stringify(redacted)).toContain('weekly-ordering');
  });

  it('leaves every other tool call untouched', () => {
    const call = {
      ...base,
      tool_name: 'workspace-read_file',
      input_data: { path: 'reports/q3.md' },
      output_data: { content: 'revenue up, and the team sharpened its skills this quarter' },
    };

    expect(redact_skill_tool_call(call)).toBe(call);
  });

  it('is applied by the wire projection itself', () => {
    const projected = public_tool_call({
      tool_name: 'workspace-read_file',
      input_data: { path: 'skills/pricing/rules.md' },
      output_data: { content: 'the whole playbook' },
      ...base,
    });

    expect(JSON.stringify(projected)).not.toContain('playbook');
  });
});
