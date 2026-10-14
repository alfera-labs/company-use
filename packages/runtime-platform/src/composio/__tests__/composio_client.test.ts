import {
  type ComposioRetryNotice,
  create_composio_client,
} from '@runtime-platform/composio/composio_client';
import { describe, expect, it } from 'vitest';

type StubPage = { items: unknown[]; next_cursor?: string | null };

function create_paging_client(pages: StubPage[] | ((cursor: string | null) => StubPage)) {
  const requested_cursors: Array<string | null> = [];
  const read_page = (cursor: string | null, call_index: number) =>
    typeof pages === 'function' ? pages(cursor) : (pages[call_index] ?? { items: [] });

  const stubbed_fetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const cursor = url.searchParams.get('cursor');
    requested_cursors.push(cursor);
    return new Response(JSON.stringify(read_page(cursor, requested_cursors.length - 1)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = create_composio_client({ api_key: 'ck_test', fetch: stubbed_fetch });
  return { client, requested_cursors };
}

function toolkit_summary(slug: string) {
  return { slug, name: slug, meta: { categories: [] } };
}

function tool_record(slug: string, toolkit_slug: string) {
  return {
    slug,
    name: slug,
    description: slug,
    toolkit: { slug: toolkit_slug },
    input_parameters: { type: 'object', properties: {} },
    output_parameters: { type: 'object', properties: {} },
  };
}

function read_page_number(url: URL) {
  const cursor = url.searchParams.get('cursor');
  if (!cursor) return 1;
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  return Number(decoded.split('-')[0]);
}

type StubAnswer = { status: number; body: unknown; headers?: Record<string, string> };

function create_answering_client(answer: (url: URL, call_index: number) => StubAnswer) {
  const requested_urls: URL[] = [];
  const retries: ComposioRetryNotice[] = [];

  const stubbed_fetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    requested_urls.push(url);
    const answered = answer(url, requested_urls.length - 1);
    return new Response(JSON.stringify(answered.body), {
      status: answered.status,
      headers: { 'content-type': 'application/json', ...(answered.headers ?? {}) },
    });
  };

  const client = create_composio_client({
    api_key: 'ck_test',
    fetch: stubbed_fetch,
    on_retry: (notice) => retries.push(notice),
  });
  return { client, requested_urls, retries };
}

describe('list_all_pages', () => {
  it('follows the cursor across pages and returns every item once', async () => {
    const { client, requested_cursors } = create_paging_client([
      { items: [toolkit_summary('github')], next_cursor: 'cur_2' },
      { items: [toolkit_summary('slack')], next_cursor: 'cur_3' },
      { items: [toolkit_summary('notion')], next_cursor: null },
    ]);

    const toolkits = await client.list_toolkits();

    expect(toolkits.map((toolkit) => toolkit.slug)).toEqual(['github', 'slack', 'notion']);
    expect(requested_cursors).toEqual([null, 'cur_2', 'cur_3']);
  });

  it('stops when the provider repeats the cursor it was given', async () => {
    const { client, requested_cursors } = create_paging_client((cursor) => ({
      items: [toolkit_summary(cursor === 'cur_stuck' ? 'stuck' : 'first')],
      next_cursor: 'cur_stuck',
    }));

    const toolkits = await client.list_toolkits();

    expect(toolkits.map((toolkit) => toolkit.slug)).toEqual(['first', 'stuck']);
    expect(requested_cursors).toEqual([null, 'cur_stuck']);
  });

  it('refuses a page whose items do not match the record schema', async () => {
    const { client } = create_paging_client([
      { items: [toolkit_summary('github')], next_cursor: 'cur_2' },
      { items: [{ slug: 'slack' }], next_cursor: null },
    ]);

    await expect(client.list_toolkits()).rejects.toThrow(/name/u);
  });

  it('refuses a page that is not a page at all', async () => {
    const { client } = create_paging_client([{ items: undefined } as unknown as StubPage]);

    await expect(client.list_toolkits()).rejects.toThrow(/items/u);
  });

  it('refuses to return a truncated list when paging runs past the page bound', async () => {
    let page_index = 0;
    const { client, requested_cursors } = create_paging_client(() => {
      page_index += 1;
      return {
        items: [toolkit_summary(`toolkit_${page_index}`)],
        next_cursor: `cur_${page_index}`,
      };
    });

    await expect(client.list_toolkits()).rejects.toThrow(
      'Composio paging for /toolkits exceeded 200 pages.',
    );
    expect(requested_cursors).toHaveLength(200);
  });
});

describe('list_all_tools', () => {
  it('reads pages 2..N at once and returns every tool in page order', async () => {
    const { client, requested_urls } = create_answering_client((url) => {
      const page_number = read_page_number(url);
      return {
        status: 200,
        body: {
          items: [tool_record(`TOOL_${page_number}`, `toolkit_${page_number}`)],
          total_pages: 4,
          current_page: page_number,
        },
      };
    });

    const tools = await client.list_all_tools();

    expect(tools.map((tool) => tool.slug)).toEqual(['TOOL_1', 'TOOL_2', 'TOOL_3', 'TOOL_4']);
    expect(requested_urls.map(read_page_number).sort()).toEqual([1, 2, 3, 4]);
    expect(requested_urls.every((url) => url.searchParams.get('toolkit_slug') === null)).toBe(true);
  });

  it('falls back to sequential paging when a constructed cursor page fails validation', async () => {
    const { client, requested_urls } = create_answering_client((url) => {
      const page_number = read_page_number(url);
      const is_constructed =
        url.searchParams.has('cursor') && !url.searchParams.get('cursor')?.startsWith('seq');
      if (is_constructed && page_number === 3) {
        return { status: 200, body: { items: [{ slug: 'TOOL_3' }], total_pages: 3 } };
      }
      if (url.searchParams.get('cursor')?.startsWith('seq')) {
        const sequential_page = Number(url.searchParams.get('cursor')?.slice(3));
        return {
          status: 200,
          body: {
            items: [tool_record(`TOOL_${sequential_page}`, 'github')],
            total_pages: 3,
            next_cursor: sequential_page < 3 ? `seq${sequential_page + 1}` : null,
          },
        };
      }
      return {
        status: 200,
        body: {
          items: [tool_record(`TOOL_${page_number}`, 'github')],
          total_pages: 3,
          next_cursor: 'seq2',
        },
      };
    });

    const tools = await client.list_all_tools();

    expect(tools.map((tool) => tool.slug)).toEqual(['TOOL_1', 'TOOL_2', 'TOOL_3']);
    expect(
      requested_urls.filter((url) => url.searchParams.get('cursor')?.startsWith('seq')),
    ).toHaveLength(2);
  });

  it('returns one record per slug when a toolkit straddles a page boundary', async () => {
    const { client } = create_answering_client((url) => {
      const page_number = read_page_number(url);
      return {
        status: 200,
        body: {
          items: [
            tool_record('COMPOSIO_CHECK_ACTIVE_CONNECTION', 'composio'),
            tool_record(`TOOL_${page_number}`, 'github'),
          ],
          total_pages: 3,
        },
      };
    });

    const tools = await client.list_all_tools();

    expect(tools.map((tool) => tool.slug)).toEqual([
      'COMPOSIO_CHECK_ACTIVE_CONNECTION',
      'TOOL_1',
      'TOOL_2',
      'TOOL_3',
    ]);
  });

  it('reads one toolkit through the per-toolkit filter instead of the whole catalog', async () => {
    const { client, requested_urls } = create_answering_client((url) => ({
      status: 200,
      body: {
        items: [tool_record('GITHUB_LIST_REPOS', url.searchParams.get('toolkit_slug') ?? '')],
        total_pages: 1,
      },
    }));

    const tools = await client.list_all_tools({ toolkit_slugs: ['github'] });

    expect(tools.map((tool) => tool.toolkit.slug)).toEqual(['github']);
    expect(requested_urls).toHaveLength(1);
    expect(requested_urls[0]?.searchParams.get('toolkit_slug')).toBe('github');
  });
});

describe('request retries', () => {
  it('retries a 429 and waits the Retry-After the provider asked for', async () => {
    const { client, requested_urls, retries } = create_answering_client((url, call_index) => {
      if (call_index < 2) {
        return {
          status: 429,
          body: { error: { message: 'Rate limited' } },
          headers: { 'retry-after': '0' },
        };
      }
      return { status: 200, body: toolkit_detail(url) };
    });

    const toolkit = await client.get_toolkit('github');

    expect(toolkit.slug).toBe('github');
    expect(requested_urls).toHaveLength(3);
    expect(
      retries.map((retry) => ({
        status: retry.status,
        attempt: retry.attempt,
        delay_ms: retry.delay_ms,
      })),
    ).toEqual([
      { status: 429, attempt: 1, delay_ms: 0 },
      { status: 429, attempt: 2, delay_ms: 0 },
    ]);
  });

  it('gives up after five attempts and throws the provider error', async () => {
    const { client, requested_urls } = create_answering_client(() => ({
      status: 503,
      body: { error: { message: 'Upstream unavailable' } },
      headers: { 'retry-after': '0' },
    }));

    await expect(client.get_toolkit('github')).rejects.toThrow('Upstream unavailable');
    expect(requested_urls).toHaveLength(5);
  });

  it('does not retry a 400, which is wrong on every attempt', async () => {
    const { client, requested_urls, retries } = create_answering_client(() => ({
      status: 400,
      body: { error: { message: 'Unknown toolkit slug' } },
    }));

    await expect(client.get_toolkit('nope')).rejects.toThrow('Unknown toolkit slug');
    expect(requested_urls).toHaveLength(1);
    expect(retries).toEqual([]);
  });
});

function fail_once_then_succeed(first_status: number, success_body: unknown) {
  return create_answering_client((_url, call_index) =>
    call_index === 0
      ? {
          status: first_status,
          body: { error: { message: `first answer ${first_status}` } },
          headers: { 'retry-after': '0' },
        }
      : { status: 200, body: success_body },
  );
}

const action_body = { arguments: { draft_id: 'r-1' } };
const action_success = { successful: true, data: { id: 'm-1' } };

describe('a call that may have taken effect', () => {
  it('sends a write action once when it answers 502, then throws', async () => {
    const { client, requested_urls } = fail_once_then_succeed(502, action_success);

    await expect(client.execute_tool('GMAIL_SEND_DRAFT', action_body)).rejects.toMatchObject({
      status: 502,
    });
    expect(requested_urls).toHaveLength(1);
  });

  it('sends a write action once when no answer comes back', async () => {
    let calls = 0;
    const client = create_composio_client({
      api_key: 'ck_test',
      fetch: async () => {
        calls += 1;
        throw new TypeError('fetch failed');
      },
    });

    await expect(client.execute_tool('GMAIL_SEND_EMAIL', action_body)).rejects.toThrow(
      'fetch failed',
    );
    expect(calls).toBe(1);
  });

  it('still repeats a write after a 429, because Composio did no work', async () => {
    const { client, requested_urls } = fail_once_then_succeed(429, action_success);

    await expect(client.execute_tool('GMAIL_SEND_DRAFT', action_body)).resolves.toMatchObject({
      successful: true,
    });
    expect(requested_urls).toHaveLength(2);
  });

  it('repeats a read-only action after a 502 when the caller says repeating is safe', async () => {
    const { client, requested_urls } = fail_once_then_succeed(502, action_success);

    await expect(
      client.execute_tool('GMAIL_FETCH_EMAILS', action_body, { repeat_when_unsure: true }),
    ).resolves.toMatchObject({ successful: true });
    expect(requested_urls).toHaveLength(2);
  });

  it('repeats a GET proxy call after a 502 and returns the answer', async () => {
    const { client, requested_urls } = fail_once_then_succeed(502, { status: 200, data: [] });

    const result = await client.proxy_execute({
      connected_account_id: 'ca_1',
      endpoint: '/gmail/v1/users/me/messages',
      method: 'GET',
    });

    expect(result).toMatchObject({ status: 200 });
    expect(requested_urls).toHaveLength(2);
  });

  it('sends a POST proxy call once when it answers 502', async () => {
    const { client, requested_urls } = fail_once_then_succeed(502, { status: 200, data: {} });

    await expect(
      client.proxy_execute({ connected_account_id: 'ca_1', endpoint: '/v2/notes', method: 'POST' }),
    ).rejects.toMatchObject({ status: 502 });
    expect(requested_urls).toHaveLength(1);
  });
});

describe('get_toolkits_detail', () => {
  it('reads every toolkit and keeps a failing one from losing the rest', async () => {
    const { client } = create_answering_client((url) => {
      if (url.pathname.endsWith('/broken')) {
        return { status: 404, body: { error: { message: 'Toolkit not found' } } };
      }
      return { status: 200, body: toolkit_detail(url) };
    });

    const results = await client.get_toolkits_detail(['github', 'broken', 'slack'], {
      concurrency: 3,
    });

    expect(results.map((result) => result.toolkit_slug)).toEqual(['github', 'broken', 'slack']);
    expect(results.map((result) => result.toolkit?.slug ?? null)).toEqual([
      'github',
      null,
      'slack',
    ]);
    expect(results[1]?.error?.message).toBe('Toolkit not found');
  });
});

function toolkit_detail(url: URL) {
  const slug = url.pathname.split('/').pop() ?? '';
  return { slug, name: slug, meta: { categories: [] } };
}
