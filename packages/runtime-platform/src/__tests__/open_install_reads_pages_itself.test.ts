import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const page = '<html><body><main><p>Useful source text.</p></main></body></html>';

function stub_the_web() {
  const fetch_mock = vi.fn(
    async (_url: string | URL | Request) =>
      new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }),
  );
  vi.stubGlobal('fetch', fetch_mock);
  return fetch_mock;
}

async function read_a_page() {
  const { runtime_read_url_tool } = await import(
    '@runtime-platform/tools/definitions/runtime_read_url'
  );
  return runtime_read_url_tool.execute(
    runtime_read_url_tool.validate_input.parse({ url: 'https://93.184.216.34/source' }),
  );
}

describe('reading a web page on an install with no search key', () => {
  it('fetches the page itself and sends its address to no reader service', async () => {
    vi.stubEnv('JINA_API_KEY', '');
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    const fetch_mock = stub_the_web();

    const result = await read_a_page();

    expect(result).toMatchObject({ success: true, data: { provider: 'direct' } });
    expect(fetch_mock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
      '93.184.216.34',
    ]);
  });

  it('uses the reader service once its key is set', async () => {
    vi.stubEnv('JINA_API_KEY', 'jina_test_key');
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    const fetch_mock = stub_the_web();

    await read_a_page();

    expect(new URL(String(fetch_mock.mock.calls[0]?.[0])).hostname).toBe('r.jina.ai');
  });
});
