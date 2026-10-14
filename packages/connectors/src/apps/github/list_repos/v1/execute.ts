import {
  github_page_size,
  page_from_cursor,
  send_github_request,
} from '@connectors/apps/github/github_requests';
import definition from '@connectors/apps/github/list_repos/v1/node.json' with { type: 'json' };
import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type { ConnectorNodeContext } from '@connectors/types';

export type ListReposInput = {
  parent_id?: string;
  query?: string;
  cursor?: string;
  limit?: number;
};

type GithubRepoRecord = {
  full_name: string;
  private?: boolean | null;
  description?: string | null;
  updated_at?: string | null;
};

type RepoOption = {
  id: string;
  label: string;
  sublabel: string;
  preview?: string;
  kind: string;
  selectable: boolean;
};

export type ListReposOutput = {
  options: RepoOption[];
  next_cursor: string | null;
};

function to_day(updated_at: string | null | undefined) {
  return updated_at ? updated_at.slice(0, 10) : 'never';
}

function to_repo_option(repository: GithubRepoRecord): RepoOption {
  return {
    id: repository.full_name,
    label: repository.full_name,
    sublabel: `${repository.private ? 'Private' : 'Public'} · updated ${to_day(repository.updated_at)}`,
    ...(repository.description ? { preview: repository.description } : {}),
    kind: 'repository',
    selectable: true,
  };
}

export async function execute(
  input: ListReposInput,
  context: ConnectorNodeContext,
): Promise<ListReposOutput> {
  const page = page_from_cursor(input.cursor);
  const page_size = input.limit ?? github_page_size;

  const repositories = await list_repositories(context, page, page_size);

  return {
    options: repositories.map(to_repo_option),
    next_cursor: repositories.length < page_size ? null : String(page + 1),
  };
}

async function list_repositories(context: ConnectorNodeContext, page: number, page_size: number) {
  try {
    return await send_github_request<GithubRepoRecord[]>(context, {
      method: 'GET',
      path: '/user/repos',
      query: { per_page: page_size, page, sort: 'updated' },
      response_schema: definition.response_schema.properties.repositories,
    });
  } catch (error) {
    if (
      !(error instanceof ConnectorHttpError) ||
      error.status !== 403 ||
      error.code !== 'unauthorized'
    ) {
      throw error;
    }
    const answer = await send_github_request<{ repositories: GithubRepoRecord[] }>(context, {
      method: 'GET',
      path: '/installation/repositories',
      query: { per_page: page_size, page },
      response_schema: definition.response_schema,
    });
    return answer.repositories;
  }
}
