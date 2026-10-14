import app_definition from '@connectors/apps/github/app.json' with { type: 'json' };
import {
  github_json_response,
  run_github_node,
  stub_github_fetch,
} from '@connectors/apps/github/github_test_context';
import { execute } from '@connectors/apps/github/list_issues/v1/execute';
import fixtures from '@connectors/apps/github/list_issues/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/github/list_issues/v1/node.json' with { type: 'json' };
import { load_connector_app, load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function full_page_of_issues() {
  return fixtures.issues_second_page.flatMap((issue) =>
    Array.from({ length: 100 }, (_, index) => ({ ...issue, number: index + 1 })),
  );
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github-list_issues-1 node.json', () => {
  it('loads through the framework loader as the key its folder proves', () => {
    const loaded = load_connector_node('apps/github/list_issues/v1/node.json', definition, {
      execute,
    });
    expect(loaded.node_key).toBe('github-list_issues-1');
    expect(loaded.implementation).toBe('execute');
    expect(loaded.description).toContain('Pull requests are excluded');
    expect(loaded.required_scopes).toEqual(['repo']);
  });

  it('has an app.json the loader accepts', () => {
    const loaded_app = load_connector_app('apps/github/app.json', app_definition);
    expect(loaded_app.app_key).toBe('github');
    expect(loaded_app.base_url).toBe('https://api.github.com');
    expect(loaded_app.auth.kind).toBe('oauth2');
    expect(loaded_app.rate_limits.rpm).toBe(80);
  });

  it('is written as JSON Schema, plural on both sides', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.response_schema.$schema).toBe(draft);
    expect(definition.input_schema.properties.repos.type).toBe('array');
    expect(definition.input_schema.required).toEqual(['repos']);
    expect(definition.output_schema.properties.repos.type).toBe('array');
    expect(definition.output_schema.properties.repos.items.required).toContain('next_cursor');
  });
});

describe('github-list_issues-1', () => {
  it('returns one row per repository and drops the pull requests', async () => {
    const calls = stub_github_fetch((request) =>
      github_json_response(
        request.url.includes('Hello-World')
          ? fixtures.issues_page_one
          : fixtures.issues_second_page,
      ),
    );

    const output = await run_github_node(definition, execute, {
      repos: [
        { owner: 'octocat', repo: 'Hello-World' },
        { owner: 'octocat', repo: 'Spoon-Knife' },
      ],
      state: 'all',
      labels: ['bug', 'documentation'],
      since: '2011-04-01T00:00:00Z',
    });

    expect(output).toEqual({
      repos: [
        {
          index: 0,
          owner: 'octocat',
          repo: 'Hello-World',
          ok: true,
          issues: [
            {
              number: 1347,
              title: 'Found a bug',
              state: 'open',
              html_url: 'https://github.com/octocat/Hello-World/issues/1347',
              body: "I'm having a problem with this.",
              labels: ['bug'],
              author: 'octocat',
              created_time: '2011-04-22T13:33:48Z',
              last_updated_time: '2011-04-22T13:33:48Z',
            },
          ],
          next_cursor: null,
          error: null,
        },
        {
          index: 1,
          owner: 'octocat',
          repo: 'Spoon-Knife',
          ok: true,
          issues: [
            {
              number: 42,
              title: 'Document the fork button',
              state: 'closed',
              html_url: 'https://github.com/octocat/Spoon-Knife/issues/42',
              body: null,
              labels: ['documentation'],
              author: 'octocat',
              created_time: '2011-05-01T08:00:00Z',
              last_updated_time: '2011-05-02T08:00:00Z',
            },
          ],
          next_cursor: null,
          error: null,
        },
      ],
    });

    expect(calls).toHaveLength(2);
    const first_call = new URL(calls[0]?.url ?? '');
    expect(first_call.pathname).toBe('/repos/octocat/Hello-World/issues');
    expect(first_call.searchParams.get('state')).toBe('all');
    expect(first_call.searchParams.get('labels')).toBe('bug,documentation');
    expect(first_call.searchParams.get('since')).toBe('2011-04-01T00:00:00Z');
    expect(first_call.searchParams.get('per_page')).toBe('100');
    expect(first_call.searchParams.get('page')).toBe('1');
    expect(calls[0]?.headers.Authorization).toBe('Bearer token_github');
    expect(calls[0]?.headers.Accept).toBe('application/vnd.github+json');
    expect(calls[0]?.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('reads the cursor of one repository as its next page number', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.issues_second_page));

    await run_github_node(definition, execute, {
      repos: [{ owner: 'octocat', repo: 'Spoon-Knife', cursor: '4' }],
    });

    expect(new URL(calls[0]?.url ?? '').searchParams.get('page')).toBe('4');
  });

  it('offers the next page when GitHub filled this one', async () => {
    stub_github_fetch(() => github_json_response(full_page_of_issues()));

    const output = await run_github_node(definition, execute, {
      repos: [{ owner: 'octocat', repo: 'Spoon-Knife', cursor: '2' }],
    });

    expect(output).toMatchObject({ repos: [{ ok: true, next_cursor: '3' }] });
  });

  it('reports one failed repository without losing the other', async () => {
    stub_github_fetch((request) =>
      request.url.includes('Ghost-Repo')
        ? github_json_response(fixtures.repository_not_found, 404)
        : github_json_response(fixtures.issues_second_page),
    );

    const output = await run_github_node(definition, execute, {
      repos: [
        { owner: 'octocat', repo: 'Ghost-Repo' },
        { owner: 'octocat', repo: 'Spoon-Knife' },
      ],
    });

    expect(output).toMatchObject({
      repos: [
        {
          index: 0,
          repo: 'Ghost-Repo',
          ok: false,
          issues: [],
          next_cursor: null,
          error: { code: 'provider_error', retryable: false },
        },
        { index: 1, repo: 'Spoon-Knife', ok: true, error: null },
      ],
    });
  });

  it('rejects a cursor that is not a page number before any request', async () => {
    const calls = stub_github_fetch(() => github_json_response([]));

    await expect(
      run_github_node(definition, execute, {
        repos: [{ owner: 'octocat', repo: 'Spoon-Knife', cursor: 'page-two' }],
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
