import type {
  ScopeExpansionLimits,
  ScopeExpansionProblem,
  ScopeOptionRow,
} from '@connectors/sync/expand_scope_selection';

export type TreeLevelEntry = {
  parent_id: string;
  depth: number;
};

export type ListChildrenResult =
  | { outcome: 'ok'; rows: readonly ScopeOptionRow[] }
  | { outcome: 'failed'; problem: ScopeExpansionProblem };

export type LevelEntryResult = {
  entry: TreeLevelEntry;
  page: ListChildrenResult;
};

export type LevelCollectResult = {
  scopes: ScopeOptionRow[];
  problems: ScopeExpansionProblem[];
  next_level: TreeLevelEntry[];
  truncated: boolean;
  seen_ids: ReadonlySet<string>;
};

type LevelItem =
  | { kind: 'problem'; problem: ScopeExpansionProblem }
  | { kind: 'row'; entry: TreeLevelEntry; row: ScopeOptionRow };

type LevelRowItem = Extract<LevelItem, { kind: 'row' }>;

function list_level_items(results: LevelEntryResult[]): LevelItem[] {
  return results.flatMap(({ entry, page }): LevelItem[] =>
    page.outcome === 'failed'
      ? [{ kind: 'problem', problem: page.problem }]
      : page.rows.filter((row) => row.has_children).map((row) => ({ kind: 'row', entry, row })),
  );
}

function drop_seen_rows(items: LevelItem[], seen_ids: ReadonlySet<string>): LevelItem[] {
  const row_ids = items.map((item) => (item.kind === 'row' ? item.row.id : null));
  const first_index_by_id = new Map(
    row_ids.map((id, index): [string | null, number] => [id, index]).reverse(),
  );
  return items.filter(
    (item, index) =>
      item.kind === 'problem' ||
      (!seen_ids.has(item.row.id) && first_index_by_id.get(item.row.id) === index),
  );
}

function find_truncation_index(items: LevelItem[], remaining_scopes: number): number {
  const row_indexes = items.flatMap((item, index) => (item.kind === 'row' ? [index] : []));
  return row_indexes[remaining_scopes] ?? -1;
}

function build_truncation_problem(
  item: LevelItem | undefined,
  limits: ScopeExpansionLimits,
): ScopeExpansionProblem[] {
  if (item?.kind !== 'row') return [];
  return [
    {
      outcome: 'subtree_truncated',
      parent_id: item.entry.parent_id,
      max_scopes: limits.max_scopes,
    },
  ];
}

export function collect_level(
  results: LevelEntryResult[],
  seen_ids: ReadonlySet<string>,
  remaining_scopes: number,
  limits: ScopeExpansionLimits,
): LevelCollectResult {
  const items = drop_seen_rows(list_level_items(results), seen_ids);
  const truncation_index = find_truncation_index(items, remaining_scopes);
  const truncated = truncation_index !== -1;
  const kept_items = truncated ? items.slice(0, truncation_index) : items;
  const kept_rows = kept_items.filter((item): item is LevelRowItem => item.kind === 'row');
  const scopes = kept_rows.map((item) => item.row);
  const next_level = truncated
    ? []
    : kept_rows
        .filter((item) => item.entry.depth + 1 < limits.max_depth)
        .map((item) => ({ parent_id: item.row.id, depth: item.entry.depth + 1 }));
  const problems = [
    ...kept_items.flatMap((item) => (item.kind === 'problem' ? [item.problem] : [])),
    ...build_truncation_problem(items[truncation_index], limits),
  ];
  const next_seen_ids = new Set([...seen_ids, ...scopes.map((scope) => scope.id)]);
  return { scopes, problems, next_level, truncated, seen_ids: next_seen_ids };
}
