import { read_url } from '@runtime-platform/tools/research';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  url: z.url(),
  provider: z.enum(['auto', 'firecrawl', 'jina', 'direct']).default('auto'),
  max_characters: z.number().int().min(1_000).max(50_000).default(12_000),
});

export const runtime_read_url_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-read_url-1',
  node_name: 'read_url',
  display_name: 'Read URL',
  description:
    'Fetches a public URL and returns clean LLM-readable content. Use after web_search when a snippet is insufficient or when you need to inspect a specific source.',
  category: 'research',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Public http:// or https:// URL to read.' },
      provider: {
        type: 'string',
        enum: ['auto', 'firecrawl', 'jina', 'direct'],
        description:
          'Reader provider. Auto uses Firecrawl if configured, then Jina, then direct fetch.',
      },
      max_characters: {
        type: 'number',
        description: 'Maximum content characters to return, 1,000-50,000.',
      },
    },
    required: ['url'],
  },
  output_schema: {
    type: 'object',
    properties: {
      provider: { type: 'string' },
      url: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      content_characters: { type: 'number' },
      truncated: { type: 'boolean' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['provider', 'url', 'content', 'content_characters', 'truncated', 'warnings'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.read_url',
  approval_policy: { mode: 'none' },
  metadata: {
    safe_for_first_milestone: true,
    providers: ['firecrawl', 'jina', 'direct'],
    approval_display_fields: ['url'],
  },
  validate_input: input_schema,
  async execute(input) {
    return {
      success: true,
      data: await read_url(input),
    };
  },
};
