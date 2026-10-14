import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type {
  ConnectorError,
  ConnectorFanOutItemResult,
  ConnectorHttpMethod,
  ConnectorNodeContext,
  ConnectorQuery,
} from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';
import { sleep } from '@coworker/shared';

const github_request_headers: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export type GithubRequest = {
  method: ConnectorHttpMethod;
  path: string;
  query?: ConnectorQuery;
  body?: unknown;
  response_schema: unknown;
};

export function send_github_request<TParsed>(
  context: ConnectorNodeContext,
  request: GithubRequest,
): Promise<TParsed> {
  return context.send_request<TParsed>({
    method: request.method,
    path: request.path,
    ...(request.query === undefined ? {} : { query: request.query }),
    ...(request.body === undefined ? {} : { body: request.body }),
    headers: github_request_headers,
    response_schema: request.response_schema as JsonSchema,
  });
}

export const github_page_size = 100;

export function page_from_cursor(cursor: string | undefined) {
  return cursor === undefined ? 1 : Number(cursor);
}

export function next_page_cursor(page: number, returned_count: number) {
  return returned_count < github_page_size ? null : String(page + 1);
}

export type GithubIssueRecord = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body?: string | null;
  labels?: (string | { name?: string | null })[] | null;
  user?: { login: string } | null;
  created_at: string;
  updated_at: string;
  pull_request?: { html_url?: string | null } | null;
};

export type GithubIssueOutput = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  labels: string[];
  author: string | null;
  created_time: string;
  last_updated_time: string;
};

function label_name(label: string | { name?: string | null }) {
  return typeof label === 'string' ? label : (label.name ?? null);
}

export function to_github_issue_output(issue: GithubIssueRecord): GithubIssueOutput {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    html_url: issue.html_url,
    body: issue.body ?? null,
    labels: (issue.labels ?? []).map(label_name).filter((name): name is string => name !== null),
    author: issue.user?.login ?? null,
    created_time: issue.created_at,
    last_updated_time: issue.updated_at,
  };
}

export type GithubRepoTarget = {
  owner?: string;
  repo?: string;
  full_name?: string;
  cursor?: string;
};

export function read_repo_name(target: GithubRepoTarget): { owner: string; repo: string } {
  if (target.owner && target.repo) return { owner: target.owner, repo: target.repo };
  const [owner, repo, extra] = (target.full_name ?? '').split('/');
  if (!owner || !repo || extra !== undefined) {
    throw new ConnectorHttpError(
      'invalid_input',
      `A GitHub repository is named owner/repo. Received: ${target.full_name ?? '(nothing)'}`,
      null,
      false,
    );
  }
  return { owner, repo };
}

export function safe_repo_name(target: GithubRepoTarget) {
  try {
    return read_repo_name(target);
  } catch {
    return { owner: target.owner ?? target.full_name ?? '', repo: target.repo ?? '' };
  }
}

type ItemOutcome<TData> = { ok: true; data: TData } | { ok: false; error: ConnectorError };

export function find_item_outcome<TData>(
  results: readonly ConnectorFanOutItemResult<TData>[],
  index: number,
): ItemOutcome<TData> {
  const result = results[index];
  if (!result) {
    return {
      ok: false,
      error: {
        code: 'node_failed',
        message: `GitHub returned no result for item ${index}.`,
        retryable: false,
      },
    };
  }
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
}

export const code_search_spacing_ms = 60_000 / 10;

let earliest_next_search_ms = 0;

export async function wait_for_code_search_slot() {
  const wait_ms = earliest_next_search_ms - Date.now();
  earliest_next_search_ms = Math.max(Date.now(), earliest_next_search_ms) + code_search_spacing_ms;
  if (wait_ms > 0) await sleep(wait_ms);
}

export function reset_code_search_pacing() {
  earliest_next_search_ms = 0;
}
