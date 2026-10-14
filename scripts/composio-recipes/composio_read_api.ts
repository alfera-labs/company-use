import { env } from '@coworker/config';
import { composio_api_base_url } from '@coworker/core/integrations/composio_api_records';
import { z } from 'zod';

const composio_tool_schema = z.object({
  slug: z.string(),
  description: z.string().nullish(),
  input_parameters: z.unknown(),
  output_parameters: z.unknown(),
  is_deprecated: z.boolean().nullish(),
});

const connected_accounts_page_schema = z.object({
  items: z.array(z.object({ id: z.string(), toolkit: z.object({ slug: z.string() }) })),
  next_cursor: z.string().nullish(),
});

export type ComposioToolDefinition = z.infer<typeof composio_tool_schema>;

function read_api_key(): string {
  const api_key = env.COMPOSIO_API_KEY;
  if (!api_key) throw new Error('COMPOSIO_API_KEY is not set, so the Composio read API is off.');
  return api_key;
}

async function get_json(path: string, query: Record<string, string>): Promise<unknown> {
  const url = new URL(`${composio_api_base_url}${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetch(url, { method: 'GET', headers: { 'x-api-key': read_api_key() } });
  if (!response.ok) throw new Error(`Composio GET ${path} answered ${response.status}.`);
  return response.json();
}

export async function get_composio_tool(tool_slug: string): Promise<ComposioToolDefinition> {
  const body = await get_json(`/tools/${encodeURIComponent(tool_slug)}`, { toolkit_versions: 'latest' });
  return composio_tool_schema.parse(body);
}

async function list_active_toolkit_slugs(cursor: string | undefined, pages_left: number): Promise<string[]> {
  const query: Record<string, string> = { statuses: 'ACTIVE', limit: '100', ...(cursor ? { cursor } : {}) };
  const body = connected_accounts_page_schema.parse(await get_json('/connected_accounts', query));
  const slugs = body.items.map((item) => item.toolkit.slug.toUpperCase());
  const next_cursor = body.next_cursor ?? undefined;
  if (!next_cursor || next_cursor === cursor || pages_left <= 1) return slugs;
  return [...slugs, ...(await list_active_toolkit_slugs(next_cursor, pages_left - 1))];
}

export async function count_active_connected_accounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const slug of await list_active_toolkit_slugs(undefined, 50)) {
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}
