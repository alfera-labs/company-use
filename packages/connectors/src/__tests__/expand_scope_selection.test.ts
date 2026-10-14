import { collect_level } from '@connectors/sync/collect_scope_level';
import {
  default_scope_expansion_limits,
  type ExpandScopeSelectionDependencies,
  expand_scope_selection,
  type ScopeOptionRow,
} from '@connectors/sync/expand_scope_selection';
import type { ConnectorSyncDimension } from '@connectors/sync_types';
import { describe, expect, it } from 'vitest';

const dimension: ConnectorSyncDimension = {
  key: 'folders',
  label: 'Folders',
  shape: 'tree',
};

function folder(id: string, label: string): ScopeOptionRow {
  return { id, label, has_children: true };
}

function file(id: string, label: string): ScopeOptionRow {
  return { id, label, has_children: false };
}

function recorded_tree_dependencies(
  tree: Record<string, ScopeOptionRow[]>,
): ExpandScopeSelectionDependencies {
  return {
    list_scope_options: async (_dimension, input) => tree[input.parent_id] ?? [],
  };
}

describe('expand_scope_selection', () => {
  it('walks the recorded tree breadth first and keeps only container rows as scopes', async () => {
    const dependencies = recorded_tree_dependencies({
      root: [folder('a', 'Folder A'), file('readme', 'README'), folder('b', 'Folder B')],
      a: [folder('a1', 'Folder A1'), file('a-note', 'Note')],
      b: [file('b-note', 'Note')],
      a1: [],
    });

    const result = await expand_scope_selection(dependencies, { dimension, root_id: 'root' });

    expect(result).toEqual({
      scopes: [folder('a', 'Folder A'), folder('b', 'Folder B'), folder('a1', 'Folder A1')],
      problems: [],
    });
  });

  it('never turns a leaf row (has_children false) into a scope', async () => {
    const dependencies = recorded_tree_dependencies({
      root: [file('only-file', 'Only file')],
    });

    const result = await expand_scope_selection(dependencies, { dimension, root_id: 'root' });

    expect(result).toEqual({ scopes: [], problems: [] });
  });

  it('stops recursing once the depth cap is reached, but keeps the row at the cap', async () => {
    const dependencies = recorded_tree_dependencies({
      root: [folder('depth_1', 'Depth 1')],
      depth_1: [folder('depth_2', 'Depth 2')],
      depth_2: [folder('depth_3', 'Depth 3')],
    });

    const result = await expand_scope_selection(dependencies, {
      dimension,
      root_id: 'root',
      limits: { max_scopes: 200, max_depth: 2, max_parallel_lists: 4 },
    });

    expect(result).toEqual({
      scopes: [folder('depth_1', 'Depth 1'), folder('depth_2', 'Depth 2')],
      problems: [],
    });
  });

  it('truncates at the 201st descendant with a problem entry instead of throwing', async () => {
    const children = Array.from({ length: 250 }, (_, index) =>
      folder(`c${index}`, `Child ${index}`),
    );
    const dependencies = recorded_tree_dependencies({
      root: children,
    });

    const result = await expand_scope_selection(dependencies, { dimension, root_id: 'root' });

    expect(result.scopes).toHaveLength(default_scope_expansion_limits.max_scopes);
    expect(result.scopes).toEqual(children.slice(0, default_scope_expansion_limits.max_scopes));
    expect(result.problems).toEqual([
      {
        outcome: 'subtree_truncated',
        parent_id: 'root',
        max_scopes: default_scope_expansion_limits.max_scopes,
      },
    ]);
  });

  it('keeps what it already found and reports a problem when a browse call throws', async () => {
    const dependencies: ExpandScopeSelectionDependencies = {
      list_scope_options: async (_dimension, input) => {
        if (input.parent_id === 'root')
          return [folder('a', 'Folder A'), folder('broken', 'Broken folder')];
        if (input.parent_id === 'broken') throw new Error('upstream browse failed');
        return [];
      },
    };

    const result = await expand_scope_selection(dependencies, { dimension, root_id: 'root' });

    expect(result.scopes).toEqual([folder('a', 'Folder A'), folder('broken', 'Broken folder')]);
    expect(result.problems).toEqual([
      {
        outcome: 'subtree_expansion_failed',
        parent_id: 'broken',
        message: 'upstream browse failed',
      },
    ]);
  });

  it('keeps the default limits as a named data record, not literals in the function body', () => {
    expect(default_scope_expansion_limits).toEqual({
      max_scopes: 200,
      max_depth: 10,
      max_parallel_lists: 4,
    });
  });

  it('never lists a node as its own descendant twice', async () => {
    const dependencies = recorded_tree_dependencies({
      root: [folder('a', 'Folder A')],
      a: [folder('a', 'Folder A')],
    });

    const result = await expand_scope_selection(dependencies, { dimension, root_id: 'root' });

    expect(result).toEqual({ scopes: [folder('a', 'Folder A')], problems: [] });
  });

  it('never turns the root into a scope, even when a descendant cycles back to it', async () => {
    const dependencies = recorded_tree_dependencies({
      root: [folder('a', 'Folder A')],
      a: [folder('root', 'Root')],
    });

    const result = await expand_scope_selection(dependencies, { dimension, root_id: 'root' });

    expect(result).toEqual({ scopes: [folder('a', 'Folder A')], problems: [] });
  });

  it('lists an id shared by two branches only once', async () => {
    const dependencies = recorded_tree_dependencies({
      root: [folder('a', 'Folder A'), folder('b', 'Folder B')],
      a: [folder('shared', 'Shared folder')],
      b: [folder('shared', 'Shared folder')],
    });

    const result = await expand_scope_selection(dependencies, { dimension, root_id: 'root' });

    expect(result).toEqual({
      scopes: [folder('a', 'Folder A'), folder('b', 'Folder B'), folder('shared', 'Shared folder')],
      problems: [],
    });
  });

  it('caps the total scope count across levels, not per level', async () => {
    const dependencies = recorded_tree_dependencies({
      root: [folder('a0', 'A0'), folder('a1', 'A1'), folder('a2', 'A2')],
      a0: [folder('a0x', 'A0x'), folder('a0y', 'A0y'), folder('a0z', 'A0z')],
      a1: [folder('a1x', 'A1x'), folder('a1y', 'A1y'), folder('a1z', 'A1z')],
      a2: [folder('a2x', 'A2x'), folder('a2y', 'A2y'), folder('a2z', 'A2z')],
    });

    const result = await expand_scope_selection(dependencies, {
      dimension,
      root_id: 'root',
      limits: { max_scopes: 5, max_depth: 10, max_parallel_lists: 4 },
    });

    expect(result.scopes.length).toBeLessThanOrEqual(5);
    expect(result.problems).toEqual([
      { outcome: 'subtree_truncated', parent_id: 'a0', max_scopes: 5 },
    ]);
  });

  it('never runs more than max_parallel_lists provider calls at once', async () => {
    const root_children = Array.from({ length: 12 }, (_, index) =>
      folder(`c${index}`, `C${index}`),
    );
    let in_flight = 0;
    let max_in_flight = 0;

    const dependencies: ExpandScopeSelectionDependencies = {
      list_scope_options: async (_dimension, input) => {
        in_flight += 1;
        max_in_flight = Math.max(max_in_flight, in_flight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        in_flight -= 1;
        return input.parent_id === 'root' ? root_children : [];
      },
    };

    await expand_scope_selection(dependencies, {
      dimension,
      root_id: 'root',
      limits: { max_scopes: 200, max_depth: 10, max_parallel_lists: 3 },
    });

    expect(max_in_flight).toBeLessThanOrEqual(3);
    expect(max_in_flight).toBeGreaterThan(1);
  });

  it('never mutates the seen_ids Set its caller passed in', () => {
    const seen_ids = new Set(['root']);
    const results = [
      {
        entry: { parent_id: 'root', depth: 0 },
        page: { outcome: 'ok' as const, rows: [folder('a', 'Folder A')] },
      },
    ];

    const result = collect_level(results, seen_ids, 200, default_scope_expansion_limits);

    expect(seen_ids).toEqual(new Set(['root']));
    expect(result.seen_ids).toEqual(new Set(['root', 'a']));
  });
});
