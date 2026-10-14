import { describe, expect, it, vi } from 'vitest';

vi.mock('@coworker/config', () => ({
  env: {
    VERCEL_AI_GATEWAY_API_KEY: 'gw_test',
    VERCEL_AI_GATEWAY_BASE_URL: 'https://ai-gateway.vercel.sh/v1',
    COWORKER_DOOR_JUDGE: 'jev',
  },
}));

const { judge_trigger_event_with_jev } = await import('@runtime-platform/triggers/jev_judge');

describe('judge_trigger_event_with_jev', () => {
  it('asks one typed question and reads the probability as P(yes)', async () => {
    const fetch_impl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
      const headers = init.headers as Record<string, string>;
      expect(headers['ai-model-id']).toBe('typesafe-ai/jev');
      expect(JSON.parse(String(init.body)).questions.door).toEqual({
        type: 'boolean',
        instructions: 'Customer asking about an invoice?',
      });
      return new Response(
        JSON.stringify({
          answers: { door: { type: 'boolean', probability: 0.97 } },
          usage: { inputTokens: 405, outputTokens: 38, totalTokens: 443 },
        }),
        { status: 200 },
      );
    });
    const verdict = await judge_trigger_event_with_jev({
      workspace_id: 'ws_1',
      question: 'Customer asking about an invoice?',
      data: { subject: 'Is invoice 1042 paid?' },
      fetch_impl: fetch_impl as never,
    });
    expect(verdict).toMatchObject({ kind: 'jev', answer: 'yes', confidence: 0.97 });
  });

  it('prices input tokens at $0.042 per million, which is 4.2 microcents per token', async () => {
    const fetch_impl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answers: { door: { type: 'boolean', probability: 0.2 } },
            usage: { inputTokens: 405, outputTokens: 38, totalTokens: 443 },
          }),
          { status: 200 },
        ),
    );
    const verdict = await judge_trigger_event_with_jev({
      workspace_id: 'ws_1',
      question: 'q',
      data: {},
      fetch_impl: fetch_impl as never,
    });
    expect(verdict.usage?.cost_microcents).toBe(1701);
  });

  it('throws on a bad answer so the caller can fall back', async () => {
    const fetch_impl = vi.fn(async () => new Response('{"answers":{}}', { status: 200 }));
    await expect(
      judge_trigger_event_with_jev({
        workspace_id: 'ws_1',
        question: 'q',
        data: {},
        fetch_impl: fetch_impl as never,
      }),
    ).rejects.toThrow(/no probability/);
    const down = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(
      judge_trigger_event_with_jev({
        workspace_id: 'ws_1',
        question: 'q',
        data: {},
        fetch_impl: down as never,
      }),
    ).rejects.toThrow(/503/);
  });
});
