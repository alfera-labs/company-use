import { env } from '@coworker/config';
import { format_error_message } from '@coworker/shared';
import {
  fetch_public_url,
  is_http_url,
  PublicUrlPolicyError,
  public_http_url,
} from '@runtime-platform/tools/public_url_fetch';
import { z } from 'zod';

export type ResearchProvider = 'auto' | 'tavily' | 'brave' | 'firecrawl' | 'jina';
export type ReadProvider = 'auto' | 'firecrawl' | 'jina' | 'direct';
type SearchDepth = 'fast' | 'standard' | 'deep';
type SearchFreshness = 'day' | 'week' | 'month' | 'year';
type SearchTopic = 'general' | 'news' | 'finance' | 'github' | 'research';

export type WebSearchInput = {
  query: string;
  max_results?: number;
  search_depth?: SearchDepth;
  include_content?: boolean;
  freshness?: SearchFreshness | undefined;
  include_domains?: string[] | undefined;
  exclude_domains?: string[] | undefined;
  provider?: ResearchProvider;
  topic?: SearchTopic;
  country?: string | undefined;
  language?: string | undefined;
};

export type ReadUrlInput = {
  url: string;
  provider?: ReadProvider;
  max_characters?: number;
};

export type ResearchResult = {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
  published_time?: string;
  score?: number;
  source_provider: Exclude<ResearchProvider, 'auto'> | 'direct';
};

const default_timeout_ms = 20_000;
const max_content_characters = 12_000;
const max_url_content_reads = 5;

const provider_string_schema = z
  .string()
  .refine((value) => value.trim().length > 0)
  .optional()
  .catch(undefined);
const provider_number_schema = z.number().finite().optional().catch(undefined);

const tavily_result_schema = z
  .object({
    title: provider_string_schema,
    url: provider_string_schema,
    content: provider_string_schema,
    raw_content: provider_string_schema,
    published_date: provider_string_schema,
    score: provider_number_schema,
  })
  .passthrough()
  .catch({});

const tavily_search_response_schema = z
  .object({
    answer: provider_string_schema,
    results: z.array(tavily_result_schema).optional().catch([]),
  })
  .passthrough()
  .catch({});

const firecrawl_search_result_schema = z
  .object({
    title: provider_string_schema,
    url: provider_string_schema,
    description: provider_string_schema,
    snippet: provider_string_schema,
    markdown: provider_string_schema,
    content: provider_string_schema,
    publishedDate: provider_string_schema,
    published_time: provider_string_schema,
    score: provider_number_schema,
    metadata: z.object({ title: provider_string_schema }).passthrough().optional().catch(undefined),
  })
  .passthrough()
  .catch({});

const firecrawl_search_response_schema = z
  .object({
    data: z
      .union([
        z
          .object({
            web: z.array(firecrawl_search_result_schema).optional().catch([]),
          })
          .passthrough(),
        z.array(firecrawl_search_result_schema),
      ])
      .optional()
      .catch(undefined),
  })
  .passthrough()
  .catch({});

const brave_search_result_schema = z
  .object({
    title: provider_string_schema,
    url: provider_string_schema,
    description: provider_string_schema,
    snippet: provider_string_schema,
    age: provider_string_schema,
  })
  .passthrough()
  .catch({});

const brave_search_response_schema = z
  .object({
    web: z
      .object({ results: z.array(brave_search_result_schema).optional().catch([]) })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough()
  .catch({});

const jina_search_result_schema = z
  .object({
    title: provider_string_schema,
    url: provider_string_schema,
    description: provider_string_schema,
    content: provider_string_schema,
    publishedTime: provider_string_schema,
    timestamp: provider_string_schema,
    score: provider_number_schema,
  })
  .passthrough()
  .catch({});

const jina_search_response_schema = z
  .object({ data: z.array(jina_search_result_schema).optional().catch([]) })
  .passthrough()
  .catch({});

const provider_read_data_schema = z
  .object({
    url: provider_string_schema,
    title: provider_string_schema,
    markdown: provider_string_schema,
    content: provider_string_schema,
    text: provider_string_schema,
  })
  .passthrough()
  .catch({});

const provider_read_response_schema = z
  .object({ data: provider_read_data_schema.optional().catch(undefined) })
  .passthrough()
  .catch({});

export async function web_search(input: WebSearchInput) {
  const normalized_input = normalize_search_input(input);
  const warnings: string[] = [];
  const providers = web_search_providers(normalized_input.provider);

  if (providers.length === 0) {
    warnings.push(
      'No web search provider is configured. Set TAVILY_API_KEY, BRAVE_SEARCH_API_KEY, FIRECRAWL_API_KEY, or JINA_API_KEY.',
    );
  }

  for (const provider of providers) {
    try {
      const result = await search_with_provider(provider, normalized_input);
      return {
        provider,
        query: normalized_input.query,
        searched_at: new Date().toISOString(),
        answer: result.answer,
        results: dedupe_results(result.results).slice(0, normalized_input.max_results),
        warnings: [...warnings, ...result.warnings],
      };
    } catch (error) {
      warnings.push(`${provider}: ${format_error_message(error)}`);
    }
  }

  return {
    provider: 'none',
    query: normalized_input.query,
    searched_at: new Date().toISOString(),
    answer: undefined,
    results: [],
    warnings,
  };
}

export async function read_url(input: ReadUrlInput) {
  const provider = input.provider ?? 'auto';
  const max_characters = clamp_int(input.max_characters ?? max_content_characters, 1_000, 50_000);
  const url = await public_http_url(input.url);
  const warnings: string[] = [];
  const providers = read_provider_priority(provider);

  for (const candidate of providers) {
    try {
      const result =
        candidate === 'firecrawl'
          ? await read_with_firecrawl(url, max_characters)
          : candidate === 'jina'
            ? await read_with_jina(url, max_characters)
            : await read_directly(url, max_characters);
      return { ...result, warnings };
    } catch (error) {
      if (error instanceof PublicUrlPolicyError) throw error;
      warnings.push(`${candidate}: ${format_error_message(error)}`);
    }
  }

  return {
    provider: 'none',
    url,
    content: '',
    content_characters: 0,
    truncated: false,
    warnings,
  };
}

function normalize_search_input(input: WebSearchInput) {
  return {
    query: input.query.trim(),
    max_results: clamp_int(input.max_results ?? 6, 1, 10),
    search_depth: input.search_depth ?? 'standard',
    include_content: input.include_content ?? true,
    freshness: input.freshness,
    include_domains: normalize_domains(input.include_domains),
    exclude_domains: normalize_domains(input.exclude_domains),
    provider: input.provider ?? 'auto',
    topic: input.topic ?? 'general',
    country: input.country?.trim(),
    language: input.language?.trim(),
  };
}

export function web_search_providers(provider: ResearchProvider) {
  if (provider !== 'auto') return [provider];

  return [
    ...(env.TAVILY_API_KEY ? (['tavily'] as const) : []),
    ...(env.FIRECRAWL_API_KEY ? (['firecrawl'] as const) : []),
    ...(env.BRAVE_SEARCH_API_KEY ? (['brave'] as const) : []),
    ...(env.JINA_API_KEY ? (['jina'] as const) : []),
  ];
}

function read_provider_priority(provider: ReadProvider) {
  if (provider !== 'auto') return [provider];

  return [
    ...(env.FIRECRAWL_API_KEY ? (['firecrawl'] as const) : []),
    ...(env.JINA_API_KEY || env.JINA_READER_WITHOUT_A_KEY ? (['jina'] as const) : []),
    'direct',
  ] satisfies Exclude<ReadProvider, 'auto'>[];
}

async function search_with_provider(
  provider: Exclude<ResearchProvider, 'auto'>,
  input: ReturnType<typeof normalize_search_input>,
) {
  if (provider === 'tavily') return search_tavily(input);
  if (provider === 'firecrawl') return search_firecrawl(input);
  if (provider === 'brave') return search_brave(input);
  return search_jina(input);
}

async function search_tavily(input: ReturnType<typeof normalize_search_input>) {
  if (!env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is not configured');

  const body = tavily_search_response_schema.parse(
    await fetch_json('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: input.query,
        max_results: input.max_results,
        search_depth: tavily_depth(input.search_depth),
        include_answer: input.search_depth === 'deep' ? 'advanced' : true,
        include_raw_content: input.include_content ? 'markdown' : false,
        ...(input.search_depth === 'deep' ? { chunks_per_source: 3 } : {}),
        topic: input.topic === 'news' || input.topic === 'finance' ? input.topic : 'general',
        ...(input.freshness ? { time_range: tavily_time_range(input.freshness) } : {}),
        ...(input.include_domains.length > 0 ? { include_domains: input.include_domains } : {}),
        ...(input.exclude_domains.length > 0 ? { exclude_domains: input.exclude_domains } : {}),
        ...(input.country ? { country: input.country } : {}),
      }),
    }),
  );
  const results = (body.results ?? []).map((item) => {
    return compact_result({
      title: item.title ?? item.url ?? 'Untitled result',
      url: item.url ?? '',
      snippet: item.content,
      content: truncate(item.raw_content, max_content_characters),
      published_time: item.published_date,
      score: item.score,
      source_provider: 'tavily',
    });
  });

  return {
    answer: body.answer,
    results: filter_valid_results(results, input),
    warnings: [],
  };
}

async function search_firecrawl(input: ReturnType<typeof normalize_search_input>) {
  if (!env.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not configured');

  const body = firecrawl_search_response_schema.parse(
    await fetch_json('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: input.query,
        limit: input.max_results,
        sources: ['web'],
        ...(input.topic === 'github' ? { categories: [{ type: 'github' }] } : {}),
        ...(input.country ? { country: input.country } : {}),
        ...(input.freshness ? { tbs: firecrawl_time_range(input.freshness) } : {}),
        ...(input.include_content
          ? {
              scrapeOptions: {
                formats: ['markdown'],
                onlyMainContent: true,
                removeBase64Images: true,
                timeout: default_timeout_ms,
              },
            }
          : {}),
      }),
    }),
  );
  const firecrawl_web_results = Array.isArray(body.data) ? [] : (body.data?.web ?? []);
  const web_results =
    firecrawl_web_results.length > 0
      ? firecrawl_web_results
      : Array.isArray(body.data)
        ? body.data
        : [];
  const results = web_results.map((item) => {
    return compact_result({
      title: item.title ?? item.metadata?.title ?? item.url ?? 'Untitled result',
      url: item.url ?? '',
      snippet: item.description ?? item.snippet,
      content: truncate(item.markdown ?? item.content, max_content_characters),
      published_time: item.publishedDate ?? item.published_time,
      score: item.score,
      source_provider: 'firecrawl',
    });
  });

  return {
    answer: undefined,
    results: filter_valid_results(results, input),
    warnings: [],
  };
}

async function search_brave(input: ReturnType<typeof normalize_search_input>) {
  if (!env.BRAVE_SEARCH_API_KEY) throw new Error('BRAVE_SEARCH_API_KEY is not configured');

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', input.query);
  url.searchParams.set('count', String(input.max_results));
  if (input.country) url.searchParams.set('country', input.country.toUpperCase());
  if (input.language) url.searchParams.set('search_lang', input.language);
  if (input.freshness) url.searchParams.set('freshness', brave_freshness(input.freshness));

  const body = brave_search_response_schema.parse(
    await fetch_json(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY,
      },
    }),
  );
  const base_results = (body.web?.results ?? []).map((item) => {
    return compact_result({
      title: item.title ?? item.url ?? 'Untitled result',
      url: item.url ?? '',
      snippet: item.description ?? item.snippet,
      published_time: item.age,
      source_provider: 'brave',
    });
  });
  const results = filter_valid_results(base_results, input);

  if (!input.include_content) return { answer: undefined, results, warnings: [] };

  const content_results = await hydrate_results_with_content(results);
  return { answer: undefined, results: content_results, warnings: [] };
}

async function search_jina(input: ReturnType<typeof normalize_search_input>) {
  if (!env.JINA_API_KEY) throw new Error('JINA_API_KEY is not configured');

  const endpoint = `https://s.jina.ai/${encodeURIComponent(input.query)}`;
  const response = await fetch_text(endpoint, {
    headers: {
      Accept: 'application/json',
      ...auth_header(env.JINA_API_KEY),
    },
  });
  const parsed = try_parse_json(response);
  const results = parsed
    ? parse_jina_json_results(jina_search_response_schema.parse(parsed))
    : parse_jina_text_results(response);
  const filtered_results = filter_valid_results(results, input).slice(0, input.max_results);

  return {
    answer: undefined,
    results: input.include_content
      ? filtered_results
      : filtered_results.map(({ content: _content, ...result }) => result),
    warnings: parsed ? [] : ['jina returned text; parsed best-effort markdown sections'],
  };
}

async function hydrate_results_with_content(results: ResearchResult[]) {
  const hydrated = await Promise.all(
    results.map(async (result, index) => {
      if (index >= max_url_content_reads) return result;
      try {
        const read_result = await read_url({
          url: result.url,
          provider: env.JINA_API_KEY ? 'jina' : 'direct',
          max_characters: max_content_characters,
        });
        return compact_result({
          ...result,
          content: read_result.content || result.content,
        });
      } catch {
        return result;
      }
    }),
  );
  return hydrated;
}

async function read_with_firecrawl(url: string, max_characters: number) {
  if (!env.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not configured');
  const response = provider_read_response_schema.parse(
    await fetch_json('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        removeBase64Images: true,
        timeout: default_timeout_ms,
      }),
    }),
  );
  const markdown = response.data?.markdown ?? response.data?.content ?? '';
  return read_result('firecrawl', url, markdown, max_characters, response.data?.title);
}

async function read_with_jina(url: string, max_characters: number) {
  const response = await fetch_text(`https://r.jina.ai/${url}`, {
    headers: {
      Accept: 'application/json',
      ...auth_header(env.JINA_API_KEY),
    },
  });
  const parsed = try_parse_json(response);
  if (!parsed) return read_result('jina', url, response, max_characters);
  const data = provider_read_response_schema.parse(parsed).data;
  return read_result(
    'jina',
    data?.url ?? url,
    data?.content ?? data?.text ?? '',
    max_characters,
    data?.title,
  );
}

async function read_directly(url: string, max_characters: number) {
  const response = await fetch_public_url(
    url,
    {
      headers: {
        Accept: 'text/html, text/markdown, text/plain, application/json;q=0.8, */*;q=0.1',
        'User-Agent': 'CoworkerResearchBot/0.1 (+https://example.local)',
      },
    },
    { timeout_ms: default_timeout_ms },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const content_type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const content = content_type.includes('html') ? html_to_text(text) : text;
  return read_result('direct', url, content, max_characters);
}

function read_result(
  provider: Exclude<ReadProvider, 'auto'> | 'none',
  url: string,
  content: string,
  max_characters: number,
  title?: string,
) {
  const truncated = content.length > max_characters;
  return {
    provider,
    url,
    ...(title ? { title } : {}),
    content: truncate(content, max_characters) ?? '',
    content_characters: content.length,
    truncated,
  };
}

async function fetch_json(url: string, init: RequestInit = {}) {
  const text = await fetch_text(url, init);
  const parsed = try_parse_json(text);
  if (!parsed) throw new Error('Response was not valid JSON');
  return parsed;
}

async function fetch_text(url: string, init: RequestInit = {}) {
  const response = await fetch_with_timeout(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
  }
  return response.text();
}

async function fetch_with_timeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), default_timeout_ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parse_jina_json_results(
  body: z.infer<typeof jina_search_response_schema>,
): ResearchResult[] {
  return (body.data ?? []).map((item) => {
    return compact_result({
      title: item.title ?? item.url ?? 'Untitled result',
      url: item.url ?? '',
      snippet: item.description,
      content: truncate(item.content, max_content_characters),
      published_time: item.publishedTime ?? item.timestamp,
      score: item.score,
      source_provider: 'jina',
    });
  });
}

function parse_jina_text_results(text: string): ResearchResult[] {
  const sections = text.split(/\n(?=Title: )/g);
  return sections.map((section) => {
    const title = match_line(section, 'Title') ?? 'Untitled result';
    const url = match_line(section, 'URL') ?? match_line(section, 'Url') ?? '';
    const content = section
      .replace(/^Title:.*$/m, '')
      .replace(/^URL:.*$/m, '')
      .trim();
    return compact_result({
      title,
      url,
      snippet: first_sentence(content),
      content: truncate(content, max_content_characters),
      source_provider: 'jina',
    });
  });
}

function filter_valid_results(
  results: ResearchResult[],
  input: Pick<ReturnType<typeof normalize_search_input>, 'include_domains' | 'exclude_domains'>,
) {
  return results.filter((result) => {
    if (!result.url || !is_http_url(result.url)) return false;
    const domain = hostname(result.url);
    if (
      input.include_domains.length > 0 &&
      !input.include_domains.some((d) => domain.endsWith(d))
    ) {
      return false;
    }
    return !input.exclude_domains.some((d) => domain.endsWith(d));
  });
}

function dedupe_results(results: ResearchResult[]) {
  const seen = new Set<string>();
  const deduped: ResearchResult[] = [];
  for (const result of results) {
    const key = canonical_url(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function compact_result(input: {
  title: string;
  url: string;
  snippet?: string | undefined;
  content?: string | undefined;
  published_time?: string | undefined;
  score?: number | undefined;
  source_provider: ResearchResult['source_provider'];
}): ResearchResult {
  return {
    title: clean_text(input.title) || 'Untitled result',
    url: input.url,
    ...(input.snippet ? { snippet: clean_text(input.snippet) } : {}),
    ...(input.content ? { content: clean_text(input.content) } : {}),
    ...(input.published_time ? { published_time: input.published_time } : {}),
    ...(input.score === undefined ? {} : { score: input.score }),
    source_provider: input.source_provider,
  };
}

function normalize_domains(domains?: string[]) {
  return [...new Set((domains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
}

function canonical_url(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function auth_header(api_key?: string) {
  return api_key ? { Authorization: `Bearer ${api_key}` } : {};
}

function tavily_depth(depth: SearchDepth) {
  if (depth === 'fast') return 'fast';
  if (depth === 'deep') return 'advanced';
  return 'basic';
}

function tavily_time_range(freshness: SearchFreshness) {
  return freshness;
}

function brave_freshness(freshness: SearchFreshness) {
  return { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[freshness];
}

function firecrawl_time_range(freshness: SearchFreshness) {
  return { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' }[freshness];
}

function clamp_int(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function try_parse_json(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function truncate(value: string | undefined, max: number) {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function clean_text(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function first_sentence(value: string) {
  const cleaned = clean_text(value);
  if (!cleaned) return undefined;
  const sentence = cleaned.match(/^.{1,240}?[.!?](\s|$)/)?.[0];
  return sentence?.trim() ?? cleaned.slice(0, 240);
}

function match_line(text: string, label: string) {
  return text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'))?.[1]?.trim();
}

function html_to_text(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
