import {
  code_search_spacing_ms,
  reset_code_search_pacing,
  wait_for_code_search_slot,
} from '@connectors/apps/github/github_requests';
import {
  github_json_response,
  run_github_node,
  stub_github_fetch,
} from '@connectors/apps/github/github_test_context';
import { execute } from '@connectors/apps/github/search_code/v1/execute';
import fixtures from '@connectors/apps/github/search_code/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/github/search_code/v1/node.json' with { type: 'json' };
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function full_page_of_matches() {
  return {
    total_count: 1_000,
    incomplete_results: false,
    items: fixtures.code_search_page_one.items
      .slice(0, 1)
      .flatMap((item) =>
        Array.from({ length: 100 }, (_, index) => ({ ...item, path: `src/file_${index}.js` })),
      ),
  };
}

beforeEach(() => {
  reset_rate_limit_buckets();
  reset_code_search_pacing();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github-search_code-1 node.json', () => {
  it('loads through the framework loader as the key its folder proves', () => {
    const loaded = load_connector_node('apps/github/search_code/v1/node.json', definition, {
      execute,
    });
    expect(loaded.node_key).toBe('github-search_code-1');
    expect(loaded.implementation).toBe('execute');
    expect(loaded.required_scopes).toEqual(['repo', 'read:org']);
    expect(definition.quirks.rate_limit).toContain('10 requests per minute');
  });

  it('is written as JSON Schema with a cursor on both sides', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.input_schema.required).toEqual(['query']);
    expect(definition.output_schema.required).toContain('next_cursor');
  });
});

describe('github-search_code-1', () => {
  it('maps a recorded page onto the node output', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.code_search_page_one));

    const output = await run_github_node(definition, execute, {
      query: 'addClass repo:jquery/jquery',
    });

    expect(output).toEqual({
      items: [
        {
          name: 'classes.js',
          path: 'src/attributes/classes.js',
          sha: 'd7212f9dee2dcc18f084d7df8f417b80846ded5a',
          html_url:
            'https://github.com/jquery/jquery/blob/825ac3773694e0cd23ee74895fd5aeb535b27da4/src/attributes/classes.js',
          repository_full_name: 'jquery/jquery',
        },
        {
          name: 'Dockerfile',
          path: 'deploy/Dockerfile',
          sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
          html_url: 'https://github.com/acme/platform/blob/main/deploy/Dockerfile',
          repository_full_name: null,
        },
      ],
      total_count: 7,
      incomplete_results: false,
      next_cursor: null,
    });

    const call = new URL(calls[0]?.url ?? '');
    expect(call.pathname).toBe('/search/code');
    expect(call.searchParams.get('q')).toBe('addClass repo:jquery/jquery');
    expect(call.searchParams.get('per_page')).toBe('100');
    expect(call.searchParams.get('page')).toBe('1');
  });

  it('offers the next page when GitHub filled this one', async () => {
    stub_github_fetch(() => github_json_response(full_page_of_matches()));

    const output = await run_github_node(definition, execute, {
      query: 'org:acme filename:Dockerfile',
      cursor: '2',
    });

    expect(output).toMatchObject({ next_cursor: '3' });
  });

  it('stops offering a cursor at the last page GitHub will serve', async () => {
    stub_github_fetch(() => github_json_response(full_page_of_matches()));

    const output = await run_github_node(definition, execute, {
      query: 'org:acme filename:Dockerfile',
      cursor: '10',
    });

    expect(output).toMatchObject({ next_cursor: null, total_count: 1_000 });
  });

  it('reports a secondary-limit 403 as a rate limit, not a refused connection', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.rate_limited, 403));

    const run = run_github_node(definition, execute, { query: 'org:acme filename:Dockerfile' });

    await expect(run).rejects.toThrow(/github rate limit/u);
    await expect(run).rejects.not.toThrow(/refused the connection/u);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('spaces its own calls under the code search rate limit', async () => {
    vi.useFakeTimers();
    reset_code_search_pacing();

    await wait_for_code_search_slot();
    let second_call_ran = false;
    const second_call = wait_for_code_search_slot().then(() => {
      second_call_ran = true;
    });

    await vi.advanceTimersByTimeAsync(code_search_spacing_ms - 1);
    expect(second_call_ran).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await second_call;
    expect(second_call_ran).toBe(true);

    vi.useRealTimers();
  });
});
