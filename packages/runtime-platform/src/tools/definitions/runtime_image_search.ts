import { image_search } from '@runtime-platform/tools/images';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(20).default(6),
});

export const runtime_image_search_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-image_search-1',
  node_name: 'image_search',
  display_name: 'Image search',
  description:
    'Finds real, high-quality photographs of a subject from the web (Brave image search, with Wikimedia Commons as a fallback). Returns candidates with a direct downloadable image_url, thumbnail, source page, and (when available) dimensions, author, and license. Use this whenever a slide, document, or page needs a real picture of a place, product, person, or thing — never construct or recall image URLs yourself.',
  category: 'research',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The subject to photograph, phrased as the caption reads (e.g. "Lisbon trams", "Golden Gate Bridge fog").',
      },
      count: { type: 'number', description: 'How many candidate images to return, 1-20.' },
    },
    required: ['query'],
  },
  output_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      provider: { type: 'string' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            image_url: { type: 'string' },
            thumbnail_url: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            title: { type: 'string' },
            source_page_url: { type: 'string' },
            source: { type: 'string' },
            author: { type: 'string' },
            license: { type: 'string' },
          },
          required: ['image_url', 'title', 'source_page_url'],
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['query', 'provider', 'results', 'warnings'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.image_search',
  approval_policy: { mode: 'none' },
  metadata: {
    safe_for_first_milestone: true,
    providers: ['wikimedia'],
    approval_display_fields: ['query'],
  },
  validate_input: input_schema,
  async execute(input) {
    return {
      success: true,
      data: await image_search(input),
    };
  },
};
