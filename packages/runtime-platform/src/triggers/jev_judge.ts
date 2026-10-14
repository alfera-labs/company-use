import { env } from '@coworker/config';
import { MICROCENTS_PER_DOLLAR } from '@coworker/config/credit_pricing';
import type { TriggerJudgeVerdict } from '@runtime-platform/triggers/trigger_judge';

const jev_model = 'typesafe-ai/jev';
const evaluation_path = '/v4/ai/evaluation-model';
const timeout_ms = 8_000;
const jev_microcents_per_input_token = (0.042 / 1_000_000) * MICROCENTS_PER_DOLLAR;

export async function judge_trigger_event_with_jev(input: {
  workspace_id: string;
  question: string;
  data: Record<string, unknown>;
  fetch_impl?: typeof fetch;
}): Promise<TriggerJudgeVerdict> {
  const api_key = env.VERCEL_AI_GATEWAY_API_KEY;
  if (!api_key) throw new Error('VERCEL_AI_GATEWAY_API_KEY is not set; Jev needs the gateway.');
  const origin = new URL(env.VERCEL_AI_GATEWAY_BASE_URL ?? 'https://ai-gateway.vercel.sh').origin;
  const response = await (input.fetch_impl ?? fetch)(`${origin}${evaluation_path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${api_key}`,
      'content-type': 'application/json',
      'ai-evaluation-model-specification-version': '4',
      'ai-model-id': jev_model,
      'ai-gateway-protocol-version': '0.0.1',
      'ai-gateway-auth-method': 'api-key',
    },
    body: JSON.stringify({
      state: { event: input.data },
      questions: { door: { type: 'boolean', instructions: input.question } },
    }),
    signal: AbortSignal.timeout(timeout_ms),
  });
  if (!response.ok)
    throw new Error(`Jev answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as {
    answers?: { door?: { type?: string; probability?: number } };
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };
  const probability = body.answers?.door?.probability;
  if (typeof probability !== 'number' || !Number.isFinite(probability)) {
    throw new Error('Jev returned no probability for the door question.');
  }
  const p = Math.min(Math.max(probability, 0), 1);
  const input_tokens = body.usage?.inputTokens ?? 0;
  const verdict: TriggerJudgeVerdict = {
    kind: 'jev',
    answer: p >= 0.5 ? 'yes' : 'no',
    confidence: p,
    reason: p >= 0.5 ? 'The event fits the question.' : 'The event does not fit the question.',
  };
  if (body.usage) {
    verdict.usage = {
      input_tokens,
      output_tokens: body.usage.outputTokens ?? 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: body.usage.totalTokens ?? input_tokens,
      cost_microcents: Math.round(input_tokens * jev_microcents_per_input_token),
    };
  }
  return verdict;
}
