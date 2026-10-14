import { describe, expect, it } from 'vitest';
import { chat_preview_lines } from '@/components/app/chat_preview_lines';
import type { RunMessage } from '@/lib/api';

function run_message(input: {
  id: string;
  role: string;
  text: string;
  is_user_visible?: boolean;
  sequence?: number;
}): RunMessage {
  return {
    run_message_id: input.id,
    message_role: input.role,
    message_content: { text: input.text },
    message_sequence: input.sequence ?? 1,
    ...(input.is_user_visible === undefined ? {} : { is_user_visible: input.is_user_visible }),
  } as unknown as RunMessage;
}

describe('chat_preview_lines', () => {
  it('keeps only the user and assistant turns a person would recognize', () => {
    const lines = chat_preview_lines([
      run_message({ id: 'm1', role: 'user', text: 'Reconcile the Stripe payouts.' }),
      run_message({ id: 'm2', role: 'tool_result', text: '{"rows":412}' }),
      run_message({ id: 'm3', role: 'assistant', text: 'Reconciled 412 payouts.' }),
    ]);

    expect(lines).toEqual([
      { line_id: 'm1', role: 'user', text: 'Reconcile the Stripe payouts.' },
      { line_id: 'm3', role: 'assistant', text: 'Reconciled 412 payouts.' },
    ]);
  });

  it('drops hidden reasoning messages that the transcript itself folds away', () => {
    const lines = chat_preview_lines([
      run_message({
        id: 'm1',
        role: 'assistant',
        text: 'Weighing which ledger to read first.',
        is_user_visible: false,
      }),
      run_message({ id: 'm2', role: 'assistant', text: 'The ledger balances.' }),
    ]);

    expect(lines.map((line) => line.line_id)).toEqual(['m2']);
  });

  it('shows only the last thing the agent said in a turn, not its progress reports', () => {
    const lines = chat_preview_lines([
      run_message({ id: 'm1', role: 'user', text: 'Reconcile the Stripe payouts.' }),
      run_message({ id: 'm2', role: 'assistant', text: 'On it — opening Stripe now.' }),
      run_message({ id: 'm3', role: 'assistant', text: 'Pulled 412 payouts, matching them.' }),
      run_message({ id: 'm4', role: 'assistant', text: 'Reconciled. Two mismatches attached.' }),
    ]);

    expect(lines).toEqual([
      { line_id: 'm1', role: 'user', text: 'Reconcile the Stripe payouts.' },
      { line_id: 'm4', role: 'assistant', text: 'Reconciled. Two mismatches attached.' },
    ]);
  });

  it('keeps one answer per turn when the person speaks in between', () => {
    const lines = chat_preview_lines([
      run_message({ id: 'm1', role: 'user', text: 'First question.' }),
      run_message({ id: 'm2', role: 'assistant', text: 'Working.' }),
      run_message({ id: 'm3', role: 'assistant', text: 'First answer.' }),
      run_message({ id: 'm4', role: 'user', text: 'Second question.' }),
      run_message({ id: 'm5', role: 'assistant', text: 'Still working.' }),
      run_message({ id: 'm6', role: 'assistant', text: 'Second answer.' }),
    ]);

    expect(lines.map((line) => line.line_id)).toEqual(['m1', 'm3', 'm4', 'm6']);
  });

  it('does not let a dropped intermediate message hide the real answer', () => {
    const lines = chat_preview_lines([
      run_message({ id: 'm1', role: 'assistant', text: 'Searching.' }),
      run_message({ id: 'm2', role: 'tool_result', text: '{"rows":412}' }),
      run_message({ id: 'm3', role: 'assistant', text: 'Found 412 rows.' }),
    ]);

    expect(lines.map((line) => line.line_id)).toEqual(['m3']);
  });

  it('keeps the newest turns when a chat is longer than the card can hold', () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      run_message({ id: `m${index}`, role: 'user', text: `Message ${index}`, sequence: index }),
    );

    const lines = chat_preview_lines(messages);

    expect(lines).toHaveLength(12);
    expect(lines[0]?.line_id).toBe('m8');
    expect(lines.at(-1)?.line_id).toBe('m19');
  });
});

describe('markdown in the preview', () => {
  it('hands the markdown through untouched, for the renderer to lay out', () => {
    const answer =
      '## Weekly report\n\n- **Revenue** is up\n- See [the sheet](https://example.com)';

    const lines = chat_preview_lines([run_message({ id: 'm1', role: 'assistant', text: answer })]);

    expect(lines[0]?.text).toBe(answer);
  });

  it('keeps a code block instead of dropping it', () => {
    const answer = 'Here is the query:\n\n```sql\nSELECT 1;\n```';

    const lines = chat_preview_lines([run_message({ id: 'm1', role: 'assistant', text: answer })]);

    expect(lines[0]?.text).toContain('```sql');
  });

  it('still drops a message that is only whitespace', () => {
    const lines = chat_preview_lines([
      run_message({ id: 'm1', role: 'assistant', text: '   \n\n  ' }),
    ]);

    expect(lines).toEqual([]);
  });
});
