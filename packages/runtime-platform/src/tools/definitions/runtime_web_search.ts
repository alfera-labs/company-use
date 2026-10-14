import { web_search } from '@runtime-platform/tools/research';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(10).default(6),
  search_depth: z.enum(['fast', 'standard', 'deep']).default('standard'),
  include_content: z.boolean().default(true),
  freshness: z.enum(['day', 'week', 'month', 'year']).optional(),
  include_domains: z.array(z.string().min(1)).max(20).optional(),
  exclude_domains: z.array(z.string().min(1)).max(20).optional(),
  provider: z.enum(['auto', 'tavily', 'brave', 'firecrawl', 'jina']).default('auto'),
  topic: z.enum(['general', 'news', 'finance', 'github', 'research']).default('general'),
  country: z.string().min(2).max(40).optional(),
  language: z.string().min(2).max(12).optional(),
});

export const runtime_web_search_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-web_search-1',
  node_name: 'web_search',
  display_name: 'Web search',
  description:
    'Searches the public web for current, source-grounded information. Returns ranked results with URLs, snippets, optional cleaned page content, provider metadata, and warnings. Use this for news, docs, public research, competitor checks, and anything that may have changed recently.',
  category: 'research',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Precise public web search query.' },
      max_results: { type: 'number', description: 'Maximum results to return, 1-10.' },
      search_depth: {
        type: 'string',
        enum: ['fast', 'standard', 'deep'],
        description: 'Latency/relevance tradeoff. Use deep for important research.',
      },
      include_content: {
        type: 'boolean',
        description: 'Whether to include cleaned source content when the provider supports it.',
      },
      freshness: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Optional freshness filter.',
      },
      include_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict results to these domains.',
      },
      exclude_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exclude these domains.',
      },
      provider: {
        type: 'string',
        enum: ['auto', 'tavily', 'brave', 'firecrawl', 'jina'],
        description: 'Search provider. Auto chooses the strongest configured provider.',
      },
      topic: {
        type: 'string',
        enum: ['general', 'news', 'finance', 'github', 'research'],
        description: 'Search vertical hint.',
      },
      country: { type: 'string', description: 'Optional country hint or country code.' },
      language: { type: 'string', description: 'Optional search language code.' },
    },
    required: ['query'],
  },
  output_schema: {
    type: 'object',
    properties: {
      provider: { type: 'string' },
      query: { type: 'string' },
      searched_at: { type: 'string' },
      answer: { type: 'string' },
      results: { type: 'array', items: { type: 'object' } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['provider', 'query', 'searched_at', 'results', 'warnings'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.web_search',
  approval_policy: { mode: 'none' },
  metadata: {
    safe_for_first_milestone: true,
    providers: ['tavily', 'firecrawl', 'brave', 'jina'],
    approval_display_fields: ['query'],
  },
  validate_input: input_schema,
  async execute(input) {
    return {
      success: true,
      data: await web_search(input),
    };
  },
};
