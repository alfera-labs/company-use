import { env } from '@coworker/config';
import { image_search_user_agent } from '@coworker/config/hosted_defaults';
import { format_error_message } from '@coworker/shared';
import { z } from 'zod';

export type ImageSearchInput = {
  query: string;
  count?: number;
};

type ImageResult = {
  image_url: string;
  thumbnail_url: string;
  width: number;
  height: number;
  title: string;
  source_page_url: string;
  source: string;
  author: string;
  license: string;
};

export type ImageSearchOutput = {
  query: string;
  provider: 'brave' | 'wikimedia' | 'none';
  results: ImageResult[];
  warnings: string[];
};

const request_timeout_ms = 20_000;
// Wikimedia asks every client to send a descriptive User-Agent with contact info.
const brave_images_endpoint = 'https://api.search.brave.com/res/v1/images/search';
const commons_endpoint = 'https://commons.wikimedia.org/w/api.php';
const commons_full_width = 1600;
const commons_thumb_width = 480;

const provider_string_schema = z.string().optional().catch(undefined);
const provider_number_schema = z.number().finite().optional().catch(undefined);

const brave_image_result_schema = z
  .object({
    title: provider_string_schema,
    url: provider_string_schema,
    source: provider_string_schema,
    properties: z
      .object({
        url: provider_string_schema,
        width: provider_number_schema,
        height: provider_number_schema,
      })
      .passthrough()
      .optional()
      .catch(undefined),
    thumbnail: z.object({ src: provider_string_schema }).passthrough().optional().catch(undefined),
  })
  .passthrough()
  .catch({});

const brave_image_response_schema = z
  .object({ results: z.array(brave_image_result_schema).optional().catch([]) })
  .passthrough()
  .catch({});

const commons_metadata_value_schema = z
  .object({ value: provider_string_schema })
  .passthrough()
  .optional()
  .catch(undefined);

const commons_image_info_schema = z
  .object({
    thumburl: provider_string_schema,
    url: provider_string_schema,
    descriptionurl: provider_string_schema,
    width: provider_number_schema,
    height: provider_number_schema,
    extmetadata: z
      .object({
        Artist: commons_metadata_value_schema,
        LicenseShortName: commons_metadata_value_schema,
      })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough()
  .catch({});

const commons_page_schema = z
  .object({
    title: provider_string_schema,
    imageinfo: z.array(commons_image_info_schema).optional().catch([]),
  })
  .passthrough()
  .catch({});

const commons_response_schema = z
  .object({
    query: z
      .object({ pages: z.record(z.string(), commons_page_schema).optional().catch({}) })
      .passthrough()
      .optional()
      .catch(undefined),
  })
  .passthrough()
  .catch({});

const non_photo_title =
  /\b(map|locator|flag|coat[\s_-]?of[\s_-]?arms|logo|icon|banner|seal|emblem|diagram|chart|plan|blazon|stemma|bandiera|escudo)\b|\.svg$/i;

export async function image_search(input: ImageSearchInput): Promise<ImageSearchOutput> {
  const query = input.query.trim();
  const count = Math.min(Math.max(input.count ?? 8, 1), 20);
  const warnings: string[] = [];

  if (!query) {
    return { query, provider: 'none', results: [], warnings: ['Empty query.'] };
  }

  if (env.BRAVE_SEARCH_API_KEY) {
    try {
      const results = await search_brave_images(query, count, env.BRAVE_SEARCH_API_KEY);
      if (results.length > 0) return { query, provider: 'brave', results, warnings };
      warnings.push('Brave image search returned no results; fell back to Wikimedia Commons.');
    } catch (error) {
      warnings.push(
        `Brave image search failed (${format_error_message(error)}); fell back to Wikimedia Commons.`,
      );
    }
  }

  try {
    const results = await search_commons(query, count);
    if (results.length > 0) return { query, provider: 'wikimedia', results, warnings };
    warnings.push(
      `No usable photographs found for "${query}". Try a broader subject (a place or landmark name) or caption an honest wider image.`,
    );
    return { query, provider: 'none', results, warnings };
  } catch (error) {
    warnings.push(`Wikimedia image search failed: ${format_error_message(error)}`);
    return { query, provider: 'none', results: [], warnings };
  }
}

async function search_brave_images(
  query: string,
  count: number,
  key: string,
): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    safesearch: 'strict',
  });
  const body = brave_image_response_schema.parse(
    await fetch_json(`${brave_images_endpoint}?${params.toString()}`, {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    }),
  );

  const out: ImageResult[] = [];
  for (const item of body.results ?? []) {
    const image_url = item.properties?.url ?? item.thumbnail?.src;
    if (!image_url) continue;
    out.push({
      image_url,
      thumbnail_url: item.thumbnail?.src ?? image_url,
      width: item.properties?.width ?? 0,
      height: item.properties?.height ?? 0,
      title: (item.title ?? '').trim(),
      source_page_url: item.url ?? '',
      source: item.source ?? '',
      author: '',
      license: '',
    });
    if (out.length >= count) break;
  }
  return out;
}

async function search_commons(query: string, count: number): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(Math.max(count * 3, 12), 40)),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(commons_full_width),
  });

  const body = commons_response_schema.parse(
    await fetch_json(`${commons_endpoint}?${params.toString()}`, {
      'User-Agent': image_search_user_agent,
      'Api-User-Agent': image_search_user_agent,
    }),
  );
  const pages = body.query?.pages ?? {};
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2);

  const scored: (ImageResult & { score: number })[] = [];
  for (const page of Object.values(pages)) {
    const title = page.title ?? '';
    if (non_photo_title.test(title)) continue;

    const info = page.imageinfo?.[0];
    const image_url = info?.thumburl ?? info?.url;
    const width = info?.width ?? 0;
    const height = info?.height ?? 0;
    if (!image_url || width < 1000 || height < 640) continue;

    const author = strip_html(info?.extmetadata?.Artist?.value) || 'Wikimedia Commons';
    const license = strip_html(info?.extmetadata?.LicenseShortName?.value) || 'See source page';

    const lowered = title.toLowerCase();
    const matched = tokens.reduce((sum, token) => sum + (lowered.includes(token) ? 1 : 0), 0);
    const score = Math.min(width / 200, 10) + matched * 5;

    scored.push({
      image_url,
      thumbnail_url: derive_commons_thumb(image_url),
      width,
      height,
      title: title.replace(/^File:/i, '').trim(),
      source_page_url: info?.descriptionurl ?? '',
      source: 'commons.wikimedia.org',
      author,
      license,
      score,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ score: _score, ...result }) => result);
}

// A Commons thumb URL contains `/<width>px-<file>`; swap the width for a lighter preview.
function derive_commons_thumb(image_url: string): string {
  return image_url.replace(/\/\d+px-/, `/${commons_thumb_width}px-`);
}

function strip_html(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
async function fetch_json(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request_timeout_ms);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
