import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('research runtime tools', () => {
  it('registers public-web research tools in the runtime registry', async () => {
    const { get_all_tools } = await import('@runtime-platform/tools/tool_registry');

    expect(get_all_tools().map((tool) => tool.node_key)).toEqual(
      expect.arrayContaining(['runtime-web_search-1', 'runtime-read_url-1']),
    );
  });

  it('uses Jina search when its key is configured and returns source-grounded results', async () => {
    vi.stubEnv('JINA_API_KEY', 'jina_test_key');
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toContain('https://s.jina.ai/');
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer jina_test_key',
        );
        return new Response(
          JSON.stringify({
            data: [
              {
                title: 'Agent search systems',
                url: 'https://example.com/agent-search',
                description: 'A practical source about agent search.',
                content: 'Agent search systems combine retrieval, source reading, and citations.',
                score: 0.91,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const { runtime_web_search_tool } = await import(
      '@runtime-platform/tools/definitions/runtime_web_search'
    );

    const input = runtime_web_search_tool.validate_input.parse({
      query: 'agent search systems',
    });
    const result = await runtime_web_search_tool.execute(input);

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        provider: 'jina',
        query: 'agent search systems',
        results: [
          expect.objectContaining({
            title: 'Agent search systems',
            url: 'https://example.com/agent-search',
            content: expect.stringContaining('retrieval'),
          }),
        ],
      }),
    });
  });

  it('uses Brave when its key is configured and the caller asks for fast search only', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave_test_key');
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toContain('api.search.brave.com');
        expect((init?.headers as Record<string, string>)['X-Subscription-Token']).toBe(
          'brave_test_key',
        );
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: 'Brave result',
                  url: 'https://example.com/brave',
                  description: 'Independent web index result.',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const { runtime_web_search_tool } = await import(
      '@runtime-platform/tools/definitions/runtime_web_search'
    );

    const input = runtime_web_search_tool.validate_input.parse({
      query: 'independent search',
      provider: 'brave',
      include_content: false,
    });
    const result = await runtime_web_search_tool.execute(input);

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        provider: 'brave',
        results: [expect.objectContaining({ title: 'Brave result' })],
      }),
    });
  });

  it('returns a clear no-provider result instead of 401 when auto search has no keys', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    vi.stubEnv('JINA_API_KEY', '');
    vi.resetModules();
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);
    const { runtime_web_search_tool } = await import(
      '@runtime-platform/tools/definitions/runtime_web_search'
    );

    const input = runtime_web_search_tool.validate_input.parse({ query: 'Lisbon weather today' });
    const result = await runtime_web_search_tool.execute(input);

    expect(fetch_mock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        provider: 'none',
        results: [],
        warnings: [expect.stringContaining('No web search provider is configured')],
      }),
    });
  });

  it('can read and clean a URL through direct fetch fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<html><head><style>.x{}</style></head><body><nav>Menu</nav><main><h1>Title</h1><p>Useful source text.</p></main><script>ignore()</script></body></html>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
      ),
    );
    const { runtime_read_url_tool } = await import(
      '@runtime-platform/tools/definitions/runtime_read_url'
    );

    const input = runtime_read_url_tool.validate_input.parse({
      url: 'https://93.184.216.34/source',
      provider: 'direct',
    });
    const result = await runtime_read_url_tool.execute(input);

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        provider: 'direct',
        url: 'https://93.184.216.34/source',
        content: 'Title Useful source text.',
        truncated: false,
      }),
    });
  });

  it('rejects private network URL reads before fetching', async () => {
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);
    const { runtime_read_url_tool } = await import(
      '@runtime-platform/tools/definitions/runtime_read_url'
    );

    const input = runtime_read_url_tool.validate_input.parse({
      url: 'http://127.0.0.1:3101/admin',
      provider: 'direct',
    });

    await expect(runtime_read_url_tool.execute(input)).rejects.toThrow('private or reserved');
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('rejects direct fetch redirects into private network targets', async () => {
    const fetch_mock = vi.fn(
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        }),
    );
    vi.stubGlobal('fetch', fetch_mock);
    const { runtime_read_url_tool } = await import(
      '@runtime-platform/tools/definitions/runtime_read_url'
    );

    const input = runtime_read_url_tool.validate_input.parse({
      url: 'https://93.184.216.34/source',
      provider: 'direct',
    });

    await expect(runtime_read_url_tool.execute(input)).rejects.toThrow('private or reserved');
    expect(fetch_mock).toHaveBeenCalledOnce();
  });
});
