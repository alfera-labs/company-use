import { z } from 'zod';
import {
  type InternalToolDefinition,
  type InternalToolView,
  safe_http_url,
} from '@/components/app/internal_tool_view';

const read_url_output = z.object({
  provider: z.string(),
  url: z.string(),
  title: z.string().optional(),
  content: z.string(),
  content_characters: z.number(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
});

const image_search_output = z.object({
  query: z.string(),
  provider: z.string(),
  warnings: z.array(z.string()),
  results: z.array(
    z.object({
      title: z.string(),
      image_url: z.string(),
      thumbnail_url: z.string().optional(),
      source_page_url: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      author: z.string().optional(),
      license: z.string().optional(),
    }),
  ),
});

const context_search_output = z.object({
  answer: z.string(),
  query: z.string(),
  result_count: z.number(),
  results: z.array(
    z.object({
      message_role: z.string(),
      message_sequence: z.number(),
      snippet: z.string(),
    }),
  ),
});

export const research_tool_definitions = {
  'runtime-read_url': {
    family: 'pages',
    title: 'Read page',
    read_view: (_input, output) => read_url_view(output),
  },
  'runtime-image_search': {
    family: 'images',
    title: 'Image search',
    read_view: (_input, output) => image_search_view(output),
  },
  'runtime-search_context': {
    family: 'history',
    title: 'Chat history',
    read_view: (_input, output) => context_search_view(output),
  },
} satisfies Record<string, InternalToolDefinition>;

function read_url_view(output: unknown): InternalToolView | null {
  const parsed = read_url_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  const url = safe_http_url(data.url);
  return {
    summary: data.title || url || 'Page content',
    ...(research_notice(data.provider, data.truncated, data.warnings)
      ? { notice: research_notice(data.provider, data.truncated, data.warnings) }
      : {}),
    text: data.content,
    ...(url ? { items: [{ title: data.title || data.url, url }] } : {}),
  };
}

function image_search_view(output: unknown): InternalToolView | null {
  const parsed = image_search_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  let unsafe_count = 0;
  const images = data.results.flatMap((result) => {
    const image_url = safe_http_url(result.thumbnail_url) || safe_http_url(result.image_url);
    if (!image_url) {
      unsafe_count += 1;
      return [];
    }
    const source_url = safe_http_url(result.source_page_url);
    return [{ title: result.title, image_url, ...(source_url ? { source_url } : {}) }];
  });
  return {
    summary: data.query,
    ...(research_notice(data.provider, false, data.warnings, unsafe_count)
      ? { notice: research_notice(data.provider, false, data.warnings, unsafe_count) }
      : {}),
    images,
    ...(images.length === 0 ? { empty_message: 'No images were found.' } : {}),
  };
}

function context_search_view(output: unknown): InternalToolView | null {
  const parsed = context_search_output.safeParse(output);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    summary: data.answer,
    items: data.results.map((result) => ({
      title: `${format_role(result.message_role)} · message ${result.message_sequence}`,
      detail: result.snippet,
    })),
    ...(data.results.length === 0
      ? { empty_message: `No chat history matched “${data.query}”.` }
      : {}),
  };
}

function format_role(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function research_notice(
  provider: string,
  truncated: boolean,
  warnings: string[],
  unsafe_count = 0,
) {
  return [
    ...(provider === 'none' ? ['No search provider was available.'] : []),
    ...(truncated ? ['The content was truncated.'] : []),
    ...(unsafe_count > 0
      ? [`${unsafe_count} image ${unsafe_count === 1 ? 'link was' : 'links were'} unsafe.`]
      : []),
    ...warnings,
  ].join(' ');
}
