import type { Database } from '@coworker/core';
import type { TextEmbedder } from '@coworker/memory/contracts/dependencies';
import { actor_key_schema, type WorkspaceId } from '@coworker/memory/contracts/keys';
import { build_scope_kind_registry } from '@coworker/memory/scopes/scope_kind_registry';
import { open_memory_view } from '@coworker/memory/view/open_memory_view';
import { create_logger, format_error_message } from '@coworker/shared';
import { build_coworker_memory_dependencies } from '@runtime-platform/memory_host/coworker_memory_dependencies';

const log = create_logger('scout_memory_clusters');

export type ScoutMemoryHit = {
  document_slug: string;
  document_title: string;
  snippet: string;
  cluster: string;
};

export type SignalCluster = { name: string; titles: string[] };

export type Embedder = TextEmbedder;

export async function search_memory_for_clusters(
  db: Database,
  input: {
    workspace_id: string;
    clusters: SignalCluster[];
    limit_per_cluster: number;
    max_clusters?: number | undefined;
    embedder?: Embedder | undefined;
  },
): Promise<ScoutMemoryHit[]> {
  const view = await open_whole_workspace_system_view(db, input.workspace_id, input.embedder);
  if (!view) return [];
  const clusters = input.clusters.slice(0, input.max_clusters ?? 3);
  const results = await Promise.all(
    clusters.map((cluster) =>
      search_one_cluster(view, { cluster, limit: input.limit_per_cluster }),
    ),
  );
  return results.flat();
}

export function build_signal_clusters(input: {
  signals: { source: string; title: string }[];
  open_loop_titles: string[];
}): SignalCluster[] {
  const by_source = new Map<string, string[]>();
  for (const signal of input.signals) {
    const titles = by_source.get(signal.source) ?? [];
    if (titles.length < 8) titles.push(signal.title);
    by_source.set(signal.source, titles);
  }
  const signal_clusters = [...by_source.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .map(([name, titles]) => ({ name, titles }));
  const loop_cluster =
    input.open_loop_titles.length > 0
      ? [{ name: 'open loops', titles: input.open_loop_titles.slice(0, 8) }]
      : [];
  return [...signal_clusters, ...loop_cluster];
}

type SystemView = Awaited<ReturnType<typeof open_memory_view>>;

async function open_whole_workspace_system_view(
  db: Database,
  workspace_id: string,
  embedder: Embedder | undefined,
): Promise<SystemView | null> {
  const dependencies = { ...build_coworker_memory_dependencies(db), embedder: embedder ?? null };
  const registry_result = build_scope_kind_registry(dependencies.extra_scope_kinds);
  if (registry_result.outcome !== 'ok') {
    log.error('memory_scope_kind_registry_invalid', registry_result);
    return null;
  }
  try {
    return await open_memory_view(dependencies, registry_result.registry, {
      workspace_id: workspace_id as WorkspaceId,
      audience: { audience_kind: 'whole_workspace', home_scope_key: null },
      actor: actor_key_schema.parse('system'),
      surface: 'job',
      run_ref: null,
    });
  } catch (error) {
    log.error('scout could not open the whole-workspace system view', {
      workspace_id,
      error: format_error_message(error),
    });
    return null;
  }
}

async function search_one_cluster(
  view: SystemView,
  input: { cluster: SignalCluster; limit: number },
): Promise<ScoutMemoryHit[]> {
  const query = input.cluster.titles.join(' ').slice(0, 1_000).trim();
  if (!query) return [];
  try {
    const result = await view.search({ query, limit: input.limit });
    return result.hits.map((hit) => ({
      document_slug: hit.document.slug,
      document_title: hit.document.title,
      snippet: hit.snippet.slice(0, 300),
      cluster: input.cluster.name,
    }));
  } catch (error) {
    log.error('Scout memory search failed; continuing without it', {
      cluster: input.cluster.name,
      error: format_error_message(error),
    });
    return [];
  }
}
