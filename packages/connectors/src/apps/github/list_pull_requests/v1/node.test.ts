import {
  github_json_response,
  run_github_node,
  stub_github_fetch,
} from '@connectors/apps/github/github_test_context';
import { execute } from '@connectors/apps/github/list_pull_requests/v1/execute';
import fixtures from '@connectors/apps/github/list_pull_requests/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/github/list_pull_requests/v1/node.json' with {
  type: 'json',
};
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github-list_pull_requests-1 node.json', () => {
  it('loads through the framework loader as the key its folder proves', () => {
    const loaded = load_connector_node('apps/github/list_pull_requests/v1/node.json', definition, {
      execute,
    });
    expect(loaded.node_key).toBe('github-list_pull_requests-1');
    expect(loaded.implementation).toBe('execute');
    expect(loaded.required_scopes).toEqual(['repo']);
  });

  it('takes the filters this endpoint really has', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(Object.keys(definition.input_schema.properties)).toEqual([
      'repos',
      'state',
      'base_branch',
    ]);
    expect(definition.output_schema.properties.repos.items.required).toContain('next_cursor');
  });
});

describe('github-list_pull_requests-1', () => {
  it('maps a recorded page onto the node output', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.pull_requests_page_one));

    const output = await run_github_node(definition, execute, {
      repos: [{ owner: 'octocat', repo: 'Hello-World' }],
      state: 'open',
      base_branch: 'main',
    });

    expect(output).toEqual({
      repos: [
        {
          index: 0,
          owner: 'octocat',
          repo: 'Hello-World',
          ok: true,
          pull_requests: [
            {
              number: 1347,
              title: 'Amazing new feature',
              state: 'open',
              html_url: 'https://github.com/octocat/Hello-World/pull/1347',
              body: 'Please pull these awesome changes in!',
              draft: false,
              author: 'octocat',
              head_branch: 'new-topic',
              base_branch: 'master',
              created_time: '2011-01-26T19:01:12Z',
              last_updated_time: '2011-01-26T19:01:12Z',
              merged_time: '2011-01-26T19:01:12Z',
            },
            {
              number: 1348,
              title: 'Work in progress',
              state: 'open',
              html_url: 'https://github.com/octocat/Hello-World/pull/1348',
              body: null,
              draft: true,
              author: null,
              head_branch: 'wip',
              base_branch: 'main',
              created_time: '2011-02-01T09:00:00Z',
              last_updated_time: '2011-02-02T09:00:00Z',
              merged_time: null,
            },
          ],
          next_cursor: null,
          error: null,
        },
      ],
    });

    const call = new URL(calls[0]?.url ?? '');
    expect(call.pathname).toBe('/repos/octocat/Hello-World/pulls');
    expect(call.searchParams.get('state')).toBe('open');
    expect(call.searchParams.get('base')).toBe('main');
    expect(call.searchParams.get('per_page')).toBe('100');
    expect(call.searchParams.get('page')).toBe('1');
  });

  it('reports one failed repository without losing the other', async () => {
    stub_github_fetch((request) =>
      request.url.includes('Ghost-Repo')
        ? github_json_response(fixtures.repository_not_found, 404)
        : github_json_response(fixtures.pull_requests_page_one),
    );

    const output = await run_github_node(definition, execute, {
      repos: [
        { owner: 'octocat', repo: 'Ghost-Repo' },
        { owner: 'octocat', repo: 'Hello-World' },
      ],
    });

    expect(output).toMatchObject({
      repos: [
        {
          index: 0,
          repo: 'Ghost-Repo',
          ok: false,
          pull_requests: [],
          error: { code: 'provider_error', retryable: false },
        },
        { index: 1, repo: 'Hello-World', ok: true, error: null },
      ],
    });
  });
});
