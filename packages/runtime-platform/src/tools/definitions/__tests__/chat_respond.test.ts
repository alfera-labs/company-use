import {
  chat_respond_input_schema,
  chat_respond_tool,
} from '@runtime-platform/tools/definitions/chat_respond';
import { platform_result_to_model_tool_result } from '@runtime-platform/tools/stored_tool_result_shape';
import { describe, expect, it } from 'vitest';

describe('the chat reply', () => {
  it('puts the answer first, then details, the deliverable and the next step', async () => {
    const result = await chat_respond_tool.execute?.({
      answer: 'All 36 are in the CRM.',
      details: '9 had duplicate rows, now merged.',
      deliverable: '| Name | Row |\n| --- | --- |\n| Ada | 12 |',
      next: '5 more have duplicates. Merge them too?',
    });

    expect(result).toMatchObject({
      success: true,
      reply_text:
        'All 36 are in the CRM.\n\n9 had duplicate rows, now merged.\n\n| Name | Row |\n| --- | --- |\n| Ada | 12 |\n\n5 more have duplicates. Merge them too?',
    });
  });

  it('refuses an answer, details or next step over its limit, and says what to cut', () => {
    const cases = [
      { answer: 'a'.repeat(301) },
      { answer: 'ok', details: 'd'.repeat(451) },
      { answer: 'ok', next: 'n'.repeat(161) },
    ];

    for (const input of cases) {
      const parsed = chat_respond_input_schema.safeParse(input);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toContain('Cut it and call chat-respond-1 again');
    }
  });

  it('takes a long draft as the deliverable, and sends longer work to a file', () => {
    const draft = chat_respond_input_schema.safeParse({
      answer: 'Here it is.',
      deliverable: 'x'.repeat(3000),
    });
    const too_long = chat_respond_input_schema.safeParse({
      answer: 'Here it is.',
      deliverable: 'x'.repeat(3001),
    });

    expect(draft.success).toBe(true);
    expect(too_long.error?.issues[0]?.message).toContain('write longer work to a file');
  });

  it('hands the reply text to the engine', () => {
    expect(
      platform_result_to_model_tool_result({
        success: true,
        data: { delivered: true },
        reply_text: 'Done.',
      }),
    ).toMatchObject({ ok: true, reply_text: 'Done.' });
  });
});
