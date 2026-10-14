import { format_event_for_judge } from '@runtime-platform/triggers/trigger_judge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replies: unknown[] = [];
const usage = {
  input_tokens: 370,
  output_tokens: 46,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  total_tokens: 416,
  cost_microcents: 12,
};
const generate_object = vi.fn(async (input: { parse?: (value: unknown) => unknown }) => {
  const reply = replies.shift();
  if (typeof reply === 'string') throw new Error(`LLM response was not valid JSON: ${reply}`);
  return {
    object: input.parse ? input.parse(reply) : reply,
    text: JSON.stringify(reply),
    result: { usage },
  };
});
vi.mock('@agent-core/llm_gateway', () => ({ create_llm_gateway: () => ({ generate_object }) }));

const { judge_trigger_event } = await import('@runtime-platform/triggers/trigger_judge');

function judge() {
  return judge_trigger_event({
    workspace_id: 'ws_1',
    question: 'Is this a customer asking about an invoice?',
    data: { sender: 'Dana <dana@example.com>', subject: 'Invoice 1042' },
  });
}

describe('judge_trigger_event reads a chatty model', () => {
  beforeEach(() => {
    replies.length = 0;
    generate_object.mockClear();
  });

  it('keeps the verdict when the model adds its own answer key, and carries the token usage', async () => {
    replies.push({
      kind: 'Inquiry',
      confidence: 0.94,
      reason: 'asks about fees',
      yes_no_answer: 'yes',
    });

    expect(await judge()).toEqual({
      kind: 'inquiry',
      answer: 'yes',
      confidence: 0.94,
      reason: 'asks about fees',
      usage,
    });
    expect(generate_object).toHaveBeenCalledTimes(1);
  });

  it('flips a confident NO into a low probability of yes', async () => {
    replies.push({
      kind: 'receipt',
      answer: 'no',
      confidence: 1,
      reason: 'a receipt, not a question',
    });

    expect(await judge()).toMatchObject({ kind: 'receipt', answer: 'no', confidence: 0 });

    replies.push({ kind: 'reply', answer: 'no', confidence: 0.7, reason: 'a thank-you' });
    expect((await judge()).confidence).toBeCloseTo(0.3);
  });

  it('reads a quoted number and a percent as a confidence', async () => {
    replies.push({ kind: 'inquiry', confidence: '0.9', reason: 'a' });
    expect((await judge()).confidence).toBe(0.9);

    replies.push({ kind: 'inquiry', confidence: '85%', reason: 'a' });
    expect((await judge()).confidence).toBeCloseTo(0.85);
  });

  it('derives the confidence from the answer when the key is missing', async () => {
    replies.push({ kind: 'inquiry', answer: 'yes', reason: 'asks for a refund' });
    expect(await judge()).toMatchObject({ kind: 'inquiry', confidence: 0.9 });

    replies.push({ kind: 'newsletter', yes: false, reason: 'marketing' });
    expect(await judge()).toMatchObject({ kind: 'newsletter', confidence: 0.1 });
  });

  it('retries once with a stricter reminder, and keeps the verdict the retry returns', async () => {
    replies.push('Yes', { kind: 'inquiry', confidence: 1, reason: 'asks for an invoice' });

    expect(await judge()).toMatchObject({ kind: 'inquiry', confidence: 1 });
    expect(generate_object).toHaveBeenCalledTimes(2);
    const retry_prompt = generate_object.mock.calls[1]?.[0] as { system_prompt: string };
    expect(retry_prompt.system_prompt).toContain('previous reply could not be read');
  });

  it('returns a null confidence instead of throwing when both replies are unreadable', async () => {
    replies.push('Yes', 'still yes');

    const verdict = await judge();

    expect(verdict.confidence).toBeNull();
    expect(verdict.kind).toBe('unknown');
    expect(verdict.reason).toContain('judge unavailable');
    expect(generate_object).toHaveBeenCalledTimes(2);
  });

  it('lets a provider failure through, so the job retries it', async () => {
    generate_object.mockRejectedValueOnce(new Error('429 rate limited'));

    await expect(judge()).rejects.toThrow('429 rate limited');
  });
});

describe('format_event_for_judge', () => {
  it('shows a website form whose text starts after a thousand blank characters', () => {
    const blank_html_layout = ' \r\n        '.repeat(100);
    const formatted = format_event_for_judge({
      subject: 'Information request from the website',
      message_text: `${blank_html_layout}Full name: Sam Example Request type: Billing Number of seats: 32`,
    });

    expect(JSON.parse(formatted).message_text).toBe(
      'Full name: Sam Example Request type: Billing Number of seats: 32',
    );
  });

  it('keeps plain fields and lists, and drops what a classifier cannot read', () => {
    const formatted = format_event_for_judge({
      subject: 'Invoice 1042',
      thread_id: 17_003,
      is_unread: true,
      label_ids: ['INBOX', 'UNREAD'],
      attachment_list: [{ name: 'contract.pdf' }],
      sender: null,
    });

    expect(JSON.parse(formatted)).toEqual({
      subject: 'Invoice 1042',
      thread_id: 17_003,
      is_unread: true,
      label_ids: ['INBOX', 'UNREAD'],
    });
  });

  it('flattens one level of nesting and goes no deeper', () => {
    const formatted = format_event_for_judge({
      payload: { headers: { 'List-Unsubscribe': '<u>' }, mime_type: 'text/plain' },
    });

    expect(JSON.parse(formatted)).toEqual({ 'payload.mime_type': 'text/plain' });
  });

  it('clips a long field and stays under the character budget with valid JSON', () => {
    const formatted = format_event_for_judge({
      message_text: 'x'.repeat(9000),
      subject: 'still here',
    });

    const fields = JSON.parse(formatted);
    expect(fields.message_text).toHaveLength(500);
    expect(fields.subject).toBe('still here');
  });

  it('stops adding fields once the budget is spent, instead of cutting the JSON in half', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`field_${index}`, 'y'.repeat(400)]),
    );

    const formatted = format_event_for_judge(wide);

    expect(formatted.length).toBeLessThanOrEqual(4000);
    expect(() => JSON.parse(formatted)).not.toThrow();
    expect(Object.keys(JSON.parse(formatted)).length).toBeGreaterThan(0);
  });

  it('honors the budget a caller passes', () => {
    const data = { a: 'z'.repeat(300), b: 'z'.repeat(300) };
    expect(format_event_for_judge(data, 200).length).toBeLessThanOrEqual(200);
  });
});
