import { execute } from '@connectors/apps/github/create_issues/v1/execute';
import fixtures from '@connectors/apps/github/create_issues/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/github/create_issues/v1/node.json' with { type: 'json' };
import {
  github_json_response,
  run_github_node,
  stub_github_fetch,
} from '@connectors/apps/github/github_test_context';
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created_issue_output = {
  number: 1347,
  title: 'Found a bug',
  state: 'open',
  html_url: 'https://github.com/octocat/Hello-World/issues/1347',
  body: "I'm having a problem with this.",
  labels: ['bug'],
  author: 'octocat',
  created_time: '2011-04-22T13:33:48Z',
  last_updated_time: '2011-04-22T13:33:48Z',
};

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github-create_issues-1 node.json', () => {
  it('loads through the framework loader as the key its folder proves', () => {
    const loaded = load_connector_node('apps/github/create_issues/v1/node.json', definition, {
      execute,
    });
    expect(loaded.node_key).toBe('github-create_issues-1');
    expect(loaded.implementation).toBe('execute');
    expect(loaded.required_scopes).toEqual(['repo']);
    expect(loaded.atomic).toBe(false);
  });

  it('is written as JSON Schema, plural on both sides', () => {
    const draft = 'https://json-schema.org/draft/2020-12/schema';
    expect(definition.input_schema.$schema).toBe(draft);
    expect(definition.output_schema.$schema).toBe(draft);
    expect(definition.response_schema.$schema).toBe(draft);
    expect(definition.input_schema.properties.issues.type).toBe('array');
    expect(definition.output_schema.properties.results.items.required).toContain('error');
  });
});

describe('github-create_issues-1', () => {
  it('creates every issue and sends only the fields the caller set', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.created_issue, 201));

    const output = await run_github_node(definition, execute, {
      issues: [
        {
          owner: 'octocat',
          repo: 'Hello-World',
          title: 'Found a bug',
          body: "I'm having a problem with this.",
          labels: ['bug'],
        },
        { owner: 'octocat', repo: 'Spoon-Knife', title: 'Just a title' },
      ],
    });

    expect(output).toEqual({
      results: [
        {
          index: 0,
          owner: 'octocat',
          repo: 'Hello-World',
          ok: true,
          issue: created_issue_output,
          error: null,
        },
        {
          index: 1,
          owner: 'octocat',
          repo: 'Spoon-Knife',
          ok: true,
          issue: created_issue_output,
          error: null,
        },
      ],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe('POST');
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/repos/octocat/Hello-World/issues');
    expect(calls[0]?.body).toBe(
      JSON.stringify({
        title: 'Found a bug',
        body: "I'm having a problem with this.",
        labels: ['bug'],
      }),
    );
    expect(calls[1]?.body).toBe(JSON.stringify({ title: 'Just a title' }));
  });

  it('reports one refused issue per item and still creates the rest', async () => {
    stub_github_fetch((request) =>
      request.url.includes('Locked-Repo')
        ? github_json_response(fixtures.validation_failed, 422)
        : github_json_response(fixtures.created_issue, 201),
    );

    const output = await run_github_node(definition, execute, {
      issues: [
        { owner: 'octocat', repo: 'Locked-Repo', title: 'No push access', labels: ['bug'] },
        { owner: 'octocat', repo: 'Hello-World', title: 'Found a bug' },
      ],
    });

    expect(output).toMatchObject({
      results: [
        {
          index: 0,
          repo: 'Locked-Repo',
          ok: false,
          issue: null,
          error: { code: 'provider_error', retryable: false },
        },
        { index: 1, repo: 'Hello-World', ok: true, error: null },
      ],
    });
    expect(output.results[0]?.error?.message).toContain(
      'Labels are only accessible with push access.',
    );
  });

  it('rejects an issue with no title before any request', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.created_issue, 201));

    await expect(
      run_github_node(definition, execute, {
        issues: [{ owner: 'octocat', repo: 'Hello-World', title: '' }],
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
