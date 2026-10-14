import { chatgpt_plan_tool_namespace } from '@agent-core/engines/pi/chatgpt_plan_payload';
import { get_pi_provider_name } from '@agent-core/engines/pi/pi_model';
import { get_pi_models } from '@agent-core/engines/pi/pi_models';
import { Type } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

function capture_the_request_body() {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('upstream closed', { status: 500 });
    }),
  );
  return bodies;
}

async function send_one_request(proxy_name: string) {
  const models = get_pi_models();
  const model = models.getModel(get_pi_provider_name(proxy_name), 'gpt-5.5');
  if (!model) throw new Error(`no gpt-5.5 under ${proxy_name}`);
  await models.completeSimple(
    model,
    {
      systemPrompt: 'You are a careful coworker.',
      messages: [{ role: 'user', content: 'What time is it?', timestamp: Date.now() }],
      tools: [
        {
          name: 'read_clock',
          description: 'Read the clock.',
          parameters: Type.Object({ zone: Type.String() }),
        },
      ],
    },
    { apiKey: 'zq-test-token', maxTokens: 64, temperature: 0.2, maxRetries: 0 },
  );
}

describe('a run on a ChatGPT plan', () => {
  it('sends only the fields the plan accepts, with the tools in one namespace', async () => {
    const bodies = capture_the_request_body();

    await send_one_request('chatgpt_plan');

    const [body] = bodies;
    expect(body).toMatchObject({ model: 'gpt-5.5', store: false, stream: true });
    for (const field of ['max_output_tokens', 'temperature', 'prompt_cache_retention']) {
      expect(body).not.toHaveProperty(field);
    }
    expect(body?.tools).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: chatgpt_plan_tool_namespace,
        tools: [expect.objectContaining({ type: 'function', name: 'read_clock' })],
      }),
    ]);
    expect(JSON.stringify(body?.input)).not.toContain('"role":"system"');
    expect(JSON.stringify(body)).toContain('You are a careful coworker.');
  });

  it('leaves a run on an OpenAI key exactly as it was', async () => {
    const bodies = capture_the_request_body();

    await send_one_request('openai_direct');

    expect(bodies[0]).toHaveProperty('max_output_tokens');
    expect(bodies[0]?.tools).toEqual([expect.objectContaining({ type: 'function' })]);
  });
});
