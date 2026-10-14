import app_definition from '@connectors/apps/github/app.json' with { type: 'json' };
import {
  github_json_response,
  run_github_node,
  stub_github_fetch,
} from '@connectors/apps/github/github_test_context';
import * as execute_module from '@connectors/apps/github/list_repos/v1/execute';
import fixtures from '@connectors/apps/github/list_repos/v1/fixtures.json' with { type: 'json' };
import definition from '@connectors/apps/github/list_repos/v1/node.json' with { type: 'json' };
import { load_connector_node } from '@connectors/load_definition';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

const node = load_connector_node('apps/github/list_repos/v1/node.json', definition, execute_module);

function run(input: unknown) {
  return run_github_node(definition, execute, input);
}

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github-list_repos-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    expect(node.node_key).toBe('github-list_repos-1');
    expect(node.implementation).toBe('execute');
    expect(node.execute).toBe(execute);
    expect(node.required_scopes).toEqual(['repo']);
  });

  it('takes the browse input and answers with the scope-option shape', () => {
    expect(Object.keys(definition.input_schema.properties)).toEqual([
      'parent_id',
      'query',
      'cursor',
      'limit',
    ]);
    expect(definition.output_schema.required).toEqual(['options', 'next_cursor']);
    expect(Object.keys(definition.output_schema.properties.options.items.properties)).toEqual([
      'id',
      'label',
      'sublabel',
      'preview',
      'kind',
      'has_children',
      'selectable',
    ]);
  });

  it('is the browse node the app sync declaration points at', () => {
    expect(app_definition.sync.dimensions).toHaveLength(1);
    expect(app_definition.sync.dimensions[0]).toMatchObject({
      key: 'repositories',
      shape: 'flat',
      browse_node: 'github-list_repos-1',
    });
  });
});

describe('github-list_repos-1 execute', () => {
  it('maps a recorded page onto pickable options keyed by owner/repo', async () => {
    const calls = stub_github_fetch(() =>
      github_json_response(fixtures.repos_page_one.repositories),
    );

    const output = await run({ limit: 2 });

    expect(output).toEqual({
      options: [
        {
          id: 'acme/app',
          label: 'acme/app',
          sublabel: 'Private · updated 2026-09-04',
          preview: 'The product monorepo',
          kind: 'repository',
          selectable: true,
        },
        {
          id: 'acme/handbook',
          label: 'acme/handbook',
          sublabel: 'Public · updated 2026-08-19',
          kind: 'repository',
          selectable: true,
        },
      ],
      next_cursor: '2',
    });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.github.com/user/repos');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      per_page: '2',
      page: '1',
      sort: 'updated',
    });
    expect(calls[0]?.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('reads the page the cursor names and reports a short page as the last one', async () => {
    const calls = stub_github_fetch(() =>
      github_json_response(fixtures.repos_last_page.repositories),
    );

    const output = await run({ cursor: '3', limit: 2 });

    expect(new URL(calls[0]?.url ?? '').searchParams.get('page')).toBe('3');
    expect(output.next_cursor).toBeNull();
    expect(output.options).toEqual([
      {
        id: 'ada/dotfiles',
        label: 'ada/dotfiles',
        sublabel: 'Public · updated never',
        preview: 'Shell and editor settings',
        kind: 'repository',
        selectable: true,
      },
    ]);
  });

  it('ignores parent_id and query, because the repository endpoint filters neither', async () => {
    const calls = stub_github_fetch(() =>
      github_json_response(fixtures.repos_last_page.repositories),
    );

    await run({ parent_id: 'alfera', query: 'handbook' });

    const parameters = new URL(calls[0]?.url ?? '').searchParams;
    expect(parameters.get('per_page')).toBe('100');
    expect(parameters.get('q')).toBeNull();
  });

  it('keeps repository browsing for an existing installation token', async () => {
    const calls = stub_github_fetch((request) =>
      new URL(request.url).pathname === '/user/repos'
        ? github_json_response({ message: 'Resource not accessible by integration' }, 403)
        : github_json_response(fixtures.repos_last_page),
    );

    const output = await run({ cursor: '3', limit: 2 });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/user/repos',
      '/installation/repositories',
    ]);
    expect(Object.fromEntries(new URL(calls[1]?.url ?? '').searchParams)).toEqual({
      per_page: '2',
      page: '3',
    });
    expect(output.options.map((option) => option.id)).toEqual(['ada/dotfiles']);
    expect(output.next_cursor).toBeNull();
  });

  it('rejects a malformed user repository response', async () => {
    const calls = stub_github_fetch(() => github_json_response([{ name: 'missing-full-name' }]));

    await expect(run({})).rejects.toMatchObject({ code: 'invalid_provider_response' });
    expect(calls).toHaveLength(1);
  });

  it('keeps a rate limit on the user endpoint', async () => {
    const calls = stub_github_fetch(() => {
      const response = github_json_response({ message: 'Secondary rate limit' }, 403);
      response.headers.set('Retry-After', '0.001');
      return response;
    });

    await expect(run({})).rejects.toMatchObject({ code: 'rate_limited' });
    expect(calls.every((call) => new URL(call.url).pathname === '/user/repos')).toBe(true);
  });

  it('refuses a cursor that is not a page number before any request', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.repos_page_one));

    await expect(run({ cursor: '../../orgs' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  it('turns a refused credential into a typed error, not a retry storm', async () => {
    const calls = stub_github_fetch(() => github_json_response(fixtures.repos_bad_credential, 401));

    await expect(run({})).rejects.toMatchObject({ code: 'unauthorized', retryable: false });
    expect(calls).toHaveLength(1);
  });
});
