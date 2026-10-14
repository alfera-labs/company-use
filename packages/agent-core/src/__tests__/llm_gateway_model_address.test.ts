import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { create_pi_provider_at_operator_address } from '@agent-core/engines/pi/pi_provider_at_operator_address';
import { resolve_llm_model } from '@agent-core/llm_gateway';
import { create_pi_ai_adapter } from '@agent-core/llm_gateway/adapters/pi_ai_adapter';
import { require_model_proxy } from '@coworker/shared';
import { createModels } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';

const proxy = require_model_proxy('openai_compatible');
const self_hosted_with_own_model = {
  COWORKER_SELF_HOSTED: 'true',
  OPENAI_COMPATIBLE_BASE_URL: 'http://host.docker.internal:11434/v1',
  OPENAI_COMPATIBLE_MODEL: 'qwen3:14b',
};

describe('a self-hosted install that names its own model address', () => {
  it('runs the agent on the operator model, before a cloud key that is still set', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run' },
        { ...self_hosted_with_own_model, OPENAI_API_KEY: 'openai-key' },
      ),
    ).toMatchObject({
      model_proxy: 'openai_compatible',
      model_provider: 'openai_compatible',
      model_name: 'qwen3:14b',
      api_key: 'no-key',
    });
  });

  it.each([
    'session_title',
    'session_summary',
    'classification',
    'onboarding_scan',
    'slack_discovery',
    'slack_workflow_proposal',
    'evaluation',
  ] as const)('runs the %s helper call on the same model, not on a cloud default name', (use_case) => {
    expect(resolve_llm_model({ use_case }, self_hosted_with_own_model)).toMatchObject({
      model_proxy: 'openai_compatible',
      model_name: 'qwen3:14b',
    });
  });

  it('runs a helper call on its own model when the operator named one', () => {
    expect(
      resolve_llm_model(
        { use_case: 'session_title' },
        { ...self_hosted_with_own_model, OPENAI_COMPATIBLE_SESSION_TITLE_MODEL: 'qwen3:4b' },
      ),
    ).toMatchObject({ model_name: 'qwen3:4b' });
  });

  it('runs the operator model when an agent still holds a name the server no longer has', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_proxy: 'openai_compatible', model_name: 'llama3.1:8b' },
        self_hosted_with_own_model,
      ),
    ).toMatchObject({ model_proxy: 'openai_compatible', model_name: 'qwen3:14b' });
  });

  it('keeps a requested model the operator did name', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run', model_proxy: 'openai_compatible', model_name: 'qwen3:4b' },
        { ...self_hosted_with_own_model, OPENAI_COMPATIBLE_SESSION_TITLE_MODEL: 'qwen3:4b' },
      ),
    ).toMatchObject({ model_name: 'qwen3:4b' });
  });

  it('is never used by the hosted product, whatever its environment holds', () => {
    expect(
      resolve_llm_model(
        { use_case: 'agent_run' },
        { ...self_hosted_with_own_model, COWORKER_SELF_HOSTED: 'false', OPENAI_API_KEY: 'k' },
      ),
    ).toMatchObject({ model_proxy: 'openai_direct', model_name: 'gpt-5.6-luna' });
    expect(() =>
      resolve_llm_model(
        { use_case: 'agent_run', model_proxy: 'openai_compatible' },
        { ...self_hosted_with_own_model, COWORKER_SELF_HOSTED: 'false', OPENAI_API_KEY: 'k' },
      ),
    ).toThrow('No API key configured for model proxy: openai_compatible');
  });
});

describe('what is assumed about a model at an address the operator names', () => {
  it('has no price, reads text only, and gets a context window that is safe when wrong', () => {
    const [model] = create_pi_provider_at_operator_address(
      proxy,
      self_hosted_with_own_model,
    ).getModels();

    expect(model).toMatchObject({
      id: 'qwen3:14b',
      baseUrl: 'http://host.docker.internal:11434/v1',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_768,
      input: ['text'],
      reasoning: false,
    });
  });

  it('takes the context window and image reading from the operator settings', () => {
    const [model] = create_pi_provider_at_operator_address(proxy, {
      ...self_hosted_with_own_model,
      OPENAI_COMPATIBLE_CONTEXT_WINDOW: '131072',
      OPENAI_COMPATIBLE_READS_IMAGES: 'true',
    }).getModels();

    expect(model).toMatchObject({ contextWindow: 131_072, input: ['text', 'image'] });
  });

  it('offers no model where the address is not served', () => {
    expect(
      create_pi_provider_at_operator_address(proxy, {
        ...self_hosted_with_own_model,
        COWORKER_SELF_HOSTED: 'false',
      }).getModels(),
    ).toEqual([]);
  });
});

describe('the request a model server at the operator address receives', () => {
  let server: Server | undefined;

  afterEach(() => server?.close());

  it('is a plain chat completion with tools, and holds no field only some servers accept', async () => {
    const received: {
      url?: string | undefined;
      authorization?: string | undefined;
      body?: Record<string, unknown>;
    } = {};
    server = createServer(async (request, response) => {
      received.url = request.url;
      received.authorization = request.headers.authorization;
      received.body = JSON.parse(await read_body(request));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(one_word_answer_stream);
    }).listen(0, '127.0.0.1');
    const environment = {
      ...self_hosted_with_own_model,
      OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    };
    const models = createModels();
    models.setProvider(create_pi_provider_at_operator_address(proxy, environment));

    const result = await create_pi_ai_adapter(models).generate_text({
      use_case: 'agent_run',
      session_id: 'ses_1',
      system_prompt: 'Be concise.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Say ok.' }] }],
      tools: [{ tool_name: 'read_file', description: 'Read a file.' }],
      model: resolve_llm_model({ use_case: 'agent_run', reasoning_level: 'high' }, environment),
    });

    expect(result.text).toBe('ok');
    expect(result.usage?.cost_microcents).toBe(0);
    expect(received.url).toBe('/v1/chat/completions');
    expect(received.authorization).toBe('Bearer no-key');
    expect(received.body).toMatchObject({
      model: 'qwen3:14b',
      stream: true,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Say ok.' },
      ],
      tools: [{ type: 'function', function: { name: 'read_file' } }],
    });
    expect(Object.keys(received.body ?? {}).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'stream',
      'stream_options',
      'tools',
    ]);
    expect(JSON.stringify(received.body)).not.toContain('"strict"');
  });
});

const one_word_answer_stream = [
  { choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } },
]
  .map(
    (chunk) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', ...chunk })}`,
  )
  .concat('data: [DONE]')
  .join('\n\n')
  .concat('\n\n');

async function read_body(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body;
}
