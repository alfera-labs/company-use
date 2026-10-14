import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { test_env } = vi.hoisted(() => ({
  test_env: { BRAVE_SEARCH_API_KEY: undefined as string | undefined },
}));
vi.mock('@coworker/config', () => ({ env: test_env }));

const { image_search } = await import('@runtime-platform/tools/images');

function commons_response(pages: Record<string, unknown>) {
  return { query: { pages } };
}
function commons_photo(id: number, over: Record<string, unknown> = {}) {
  return {
    pageid: id,
    title: (over.title as string) ?? `File:Lisbon trams ${id}.jpg`,
    imageinfo: [
      {
        thumburl: `https://upload.wikimedia.org/x/1600px-a${id}.jpg`,
        url: `https://upload.wikimedia.org/x/a${id}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:a${id}.jpg`,
        width: (over.width as number) ?? 2400,
        height: (over.height as number) ?? 1600,
        extmetadata: {
          Artist: { value: '<a href="/x">Jane Doe</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
        },
      },
    ],
  };
}

function brave_response(results: unknown[]) {
  return { type: 'images', results };
}
function brave_photo(id: number) {
  return {
    title: `Lisbon trams ${id}`,
    url: `https://travelsite.example/lisbon-${id}`,
    source: 'travelsite.example',
    thumbnail: { src: `https://imgs.brave.example/thumb-${id}.jpg` },
    properties: { url: `https://cdn.example/lisbon-${id}.jpg` },
  };
}

function route_fetch(routes: { brave?: unknown; commons?: unknown; braveOk?: boolean }) {
  return vi.fn(async (url: string) => {
    const is_brave = url.includes('api.search.brave.com');
    const payload = is_brave ? routes.brave : routes.commons;
    const ok = is_brave ? (routes.braveOk ?? true) : true;
    return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
  });
}

beforeEach(() => {
  test_env.BRAVE_SEARCH_API_KEY = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image_search — Brave primary', () => {
  beforeEach(() => {
    test_env.BRAVE_SEARCH_API_KEY = 'test-key';
  });

  it('returns high-quality web photos from Brave with a downloadable url', async () => {
    vi.stubGlobal(
      'fetch',
      route_fetch({ brave: brave_response([brave_photo(1), brave_photo(2)]) }),
    );

    const out = await image_search({ query: 'Lisbon trams', count: 5 });

    expect(out.provider).toBe('brave');
    expect(out.results).toHaveLength(2);
    const [first] = out.results;
    if (!first) throw new Error('expected a result');
    expect(first.image_url).toBe('https://cdn.example/lisbon-1.jpg');
    expect(first.thumbnail_url).toContain('imgs.brave.example');
    expect(first.source).toBe('travelsite.example');
    expect(first.source_page_url).toContain('travelsite.example');
  });

  it('falls back to Wikimedia when Brave returns nothing', async () => {
    vi.stubGlobal(
      'fetch',
      route_fetch({
        brave: brave_response([]),
        commons: commons_response({ '1': commons_photo(1) }),
      }),
    );

    const out = await image_search({ query: 'Lisbon trams' });
    expect(out.provider).toBe('wikimedia');
    expect(out.results[0]?.author).toBe('Jane Doe');
    expect(out.warnings.join(' ')).toMatch(/fell back/i);
  });

  it('falls back to Wikimedia when Brave errors', async () => {
    vi.stubGlobal(
      'fetch',
      route_fetch({ braveOk: false, commons: commons_response({ '1': commons_photo(1) }) }),
    );

    const out = await image_search({ query: 'Lisbon' });
    expect(out.provider).toBe('wikimedia');
    expect(out.warnings.join(' ')).toMatch(/fell back/i);
  });
});

describe('image_search — Wikimedia fallback (no Brave key)', () => {
  it('uses Wikimedia and carries attribution', async () => {
    vi.stubGlobal(
      'fetch',
      route_fetch({ commons: commons_response({ '1': commons_photo(1), '2': commons_photo(2) }) }),
    );

    const out = await image_search({ query: 'Lisbon trams', count: 5 });
    expect(out.provider).toBe('wikimedia');
    expect(out.results).toHaveLength(2);
    const [first] = out.results;
    if (!first) throw new Error('expected a result');
    expect(first.image_url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    expect(first.license).toBe('CC BY-SA 4.0');
    expect(first.title).not.toMatch(/^File:/);
  });

  it('drops non-photographic assets (maps, flags, svg)', async () => {
    vi.stubGlobal(
      'fetch',
      route_fetch({
        commons: commons_response({
          '1': commons_photo(1, { title: 'File:Map of Portugal.png' }),
          '2': commons_photo(2, { title: 'File:Flag of Lisbon.svg' }),
          '3': commons_photo(3, { title: 'File:Lisbon panorama.jpg' }),
        }),
      }),
    );

    const out = await image_search({ query: 'Lisbon' });
    expect(out.results.map((r) => r.title)).toEqual(['Lisbon panorama.jpg']);
  });

  it('skips images too small to fill a slide without upscaling', async () => {
    vi.stubGlobal(
      'fetch',
      route_fetch({
        commons: commons_response({ '1': commons_photo(1, { width: 640, height: 400 }) }),
      }),
    );

    const out = await image_search({ query: 'Porto' });
    expect(out.results).toHaveLength(0);
    expect(out.provider).toBe('none');
  });

  it('rejects an empty query without a network call', async () => {
    const fetch_spy = route_fetch({ commons: commons_response({}) });
    vi.stubGlobal('fetch', fetch_spy);

    const out = await image_search({ query: '   ' });
    expect(out.provider).toBe('none');
    expect(fetch_spy).not.toHaveBeenCalled();
  });
});
