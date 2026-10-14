import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RuntimeAgentEngineEvent } from '@agent-core/runs';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ChatRequest = { model: string; messages: Record<string, unknown>[] } & Record<string, unknown>;

let server: Server | undefined;

afterEach(() => {
  server?.close();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('an agent run on a model server at the operator address', () => {
  it('calls a tool the model asked for, sends the result back, and ends on the answer', async () => {
    const requests: ChatRequest[] = [];
    server = createServer(async (request, response) => {
      requests.push(JSON.parse(await read_body(request)));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(requests.length === 1 ? stream_that_calls_the_tool : stream_that_answers);
    }).listen(0, '127.0.0.1');
    const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    vi.stubEnv('COWORKER_SELF_HOSTED', 'true');
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', address);
    vi.stubEnv('OPENAI_COMPATIBLE_MODEL', 'qwen3:14b');
    vi.resetModules();
    const { create_pi_engine } = await import('@agent-core/engines/pi');
    const tool_inputs: unknown[] = [];

    const events = await collect_events(
      create_pi_engine().run({
        run_key: 'run_test',
        session_key: 'session_test',
        system_prompt: 'Keep the response operational.',
        model: {
          model_provider: 'openai_compatible',
          model_proxy: 'openai_compatible',
          model_name: 'qwen3:14b',
          reasoning_level: 'high',
        },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Check the launch.' }] }],
        tools: [
          {
            tool_name: 'runtime-search_context-1',
            description: 'Search context.',
            input_schema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
            async execute(input) {
              tool_inputs.push(input);
              return { ok: true, content_json: { answer: 'Workspace context checked.' } };
            },
          },
        ],
        metadata: {},
        signal: new AbortController().signal,
      }),
    );

    expect(tool_inputs).toEqual([{ query: 'launch' }]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.slice(-2)).toMatchObject([
      {
        role: 'assistant',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'runtime-search_context-1' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1' },
    ]);
    expect(JSON.stringify(requests[1]?.messages.at(-1))).toContain('Workspace context checked.');
    for (const request of requests) {
      expect(request.model).toBe('qwen3:14b');
      expect(Object.keys(request).sort()).toEqual([
        'max_tokens',
        'messages',
        'model',
        'stream',
        'stream_options',
        'tools',
      ]);
    }
    expect(JSON.stringify(events.at(-1))).toContain('The launch is on track.');
  });
});

const stream_that_calls_the_tool = event_stream([
  {
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'runtime-search_context-1', arguments: '{"query":"launch"}' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  { choices: [], usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 } },
]);

const stream_that_answers = event_stream([
  {
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: 'The launch is on track.' },
        finish_reason: null,
      },
    ],
  },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 70, completion_tokens: 6, total_tokens: 76 } },
]);

function event_stream(chunks: Record<string, unknown>[]) {
  return chunks
    .map(
      (chunk) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', ...chunk })}`,
    )
    .concat('data: [DONE]')
    .join('\n\n')
    .concat('\n\n');
}

async function read_body(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body;
}

async function collect_events(events: AsyncIterable<RuntimeAgentEngineEvent>) {
  const collected_events: RuntimeAgentEngineEvent[] = [];
  for await (const event of events) collected_events.push(event);
  return collected_events;
}
