import {
  collect_level,
  type LevelEntryResult,
  type ListChildrenResult,
  type TreeLevelEntry,
} from '@connectors/sync/collect_scope_level';
import type { ConnectorSyncDimension } from '@connectors/sync_types';
import { format_error_message } from '@coworker/shared';
import pLimit from 'p-limit';

export type ScopeExpansionLimits = {
  max_scopes: number;
  max_depth: number;
  max_parallel_lists: number;
};

export const default_scope_expansion_limits: ScopeExpansionLimits = {
  max_scopes: 200,
  max_depth: 10,
  max_parallel_lists: 4,
};

export type ScopeOptionRow = {
  id: string;
  label: string;
  kind?: string;
  has_children?: boolean;
  selectable?: boolean;
};

export type ListScopeOptions = (
  dimension: ConnectorSyncDimension,
  input: { parent_id: string },
) => Promise<readonly ScopeOptionRow[]>;

export type ExpandScopeSelectionDependencies = {
  list_scope_options: ListScopeOptions;
};

export type ScopeExpansionProblem =
  | { outcome: 'subtree_truncated'; parent_id: string; max_scopes: number }
  | { outcome: 'subtree_expansion_failed'; parent_id: string; message: string };

export type ExpandScopeSelectionInput = {
  dimension: ConnectorSyncDimension;
  root_id: string;
  limits?: ScopeExpansionLimits;
};

export type ExpandScopeSelectionResult = {
  scopes: ScopeOptionRow[];
  problems: ScopeExpansionProblem[];
};

export async function expand_scope_selection(
  dependencies: ExpandScopeSelectionDependencies,
  input: ExpandScopeSelectionInput,
): Promise<ExpandScopeSelectionResult> {
  const limits = input.limits ?? default_scope_expansion_limits;
  const seen_ids = new Set<string>([input.root_id]);
  const first_level: TreeLevelEntry[] = [{ parent_id: input.root_id, depth: 0 }];

  return expand_levels(
    dependencies,
    input.dimension,
    first_level,
    seen_ids,
    limits,
    limits.max_scopes,
  );
}

async function expand_levels(
  dependencies: ExpandScopeSelectionDependencies,
  dimension: ConnectorSyncDimension,
  level: TreeLevelEntry[],
  seen_ids: ReadonlySet<string>,
  limits: ScopeExpansionLimits,
  remaining_scopes: number,
): Promise<ExpandScopeSelectionResult> {
  if (level.length === 0) return { scopes: [], problems: [] };

  const results = await list_level_pages(dependencies, dimension, level, limits);
  const level_result = collect_level(results, seen_ids, remaining_scopes, limits);

  if (level_result.truncated || level_result.next_level.length === 0) {
    return { scopes: level_result.scopes, problems: level_result.problems };
  }

  const rest = await expand_levels(
    dependencies,
    dimension,
    level_result.next_level,
    level_result.seen_ids,
    limits,
    remaining_scopes - level_result.scopes.length,
  );
  return {
    scopes: [...level_result.scopes, ...rest.scopes],
    problems: [...level_result.problems, ...rest.problems],
  };
}

async function list_level_pages(
  dependencies: ExpandScopeSelectionDependencies,
  dimension: ConnectorSyncDimension,
  level: TreeLevelEntry[],
  limits: ScopeExpansionLimits,
): Promise<LevelEntryResult[]> {
  const limit = pLimit(limits.max_parallel_lists);
  return limit.map(level, async (entry) => ({
    entry,
    page: await list_children(dependencies, dimension, entry),
  }));
}

async function list_children(
  dependencies: ExpandScopeSelectionDependencies,
  dimension: ConnectorSyncDimension,
  entry: TreeLevelEntry,
): Promise<ListChildrenResult> {
  try {
    const rows = await dependencies.list_scope_options(dimension, { parent_id: entry.parent_id });
    return { outcome: 'ok', rows };
  } catch (error) {
    return {
      outcome: 'failed',
      problem: {
        outcome: 'subtree_expansion_failed',
        parent_id: entry.parent_id,
        message: format_error_message(error),
      },
    };
  }
}
