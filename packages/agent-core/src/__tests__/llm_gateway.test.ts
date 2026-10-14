import { create_llm_gateway, type LlmRequest } from '@agent-core/llm_gateway';
import { create_fake_llm_adapter } from '@agent-core/llm_gateway/adapters/fake_llm_adapter';
import { describe, expect, it } from 'vitest';

describe('LLM gateway policy', () => {
  it('rejects tools for use cases that disable tools', async () => {
    const gateway = create_test_gateway();

    await expect(
      gateway.generate_text({
        ...title_request(),
        tools: [{ tool_name: 'search', description: 'Search.', input_schema: { type: 'object' } }],
      }),
    ).rejects.toThrow('LLM use case session_title does not allow tools.');
  });

  it('rejects images for use cases that disable images', async () => {
    const gateway = create_test_gateway();

    await expect(
      gateway.generate_text({
        ...title_request(),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Title this.' },
              { type: 'image', data: 'base64-image', mime_type: 'image/png' },
            ],
          },
        ],
      }),
    ).rejects.toThrow('LLM use case session_title does not allow images.');
  });

  it('rejects streaming for non-streaming use cases', () => {
    const gateway = create_test_gateway();

    expect(() => gateway.stream(title_request())).toThrow(
      'LLM use case session_title does not allow streaming.',
    );
  });

  it('allows agent run requests to use streaming, tools, and images', async () => {
    const gateway = create_test_gateway();
    const events = [];

    for await (const event of gateway.stream({
      use_case: 'agent_run',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            { type: 'image', data: 'base64-image', mime_type: 'image/png' },
          ],
        },
      ],
      tools: [{ tool_name: 'inspect', description: 'Inspect.', input_schema: { type: 'object' } }],
    })) {
      events.push(event.type);
    }

    expect(events).toEqual(['text_delta', 'message']);
  });
});

function create_test_gateway() {
  return create_llm_gateway({
    adapter: create_fake_llm_adapter('ok'),
    environment: { OPENAI_API_KEY: 'test-openai-key' },
  });
}

function title_request(): LlmRequest {
  return {
    use_case: 'session_title',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Title this.' }] }],
  };
}
