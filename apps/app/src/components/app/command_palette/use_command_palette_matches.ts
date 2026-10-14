import { useEffect, useMemo, useState } from 'react';
import type {
  CommandPaletteGroupResult,
  CommandPaletteSource,
} from '@/components/app/command_palette/command_palette_source';

const remote_search_debounce_ms = 180;

export function useCommandPaletteMatches(
  sources: readonly CommandPaletteSource[],
  query_text: string,
): CommandPaletteGroupResult[] {
  const local_groups = useLocalGroups(sources, query_text);
  const remote_groups = useRemoteGroups(sources, query_text);

  return useMemo(
    () =>
      sources
        .map(
          (source) =>
            local_groups.find((group) => group.source_id === source.source_id) ??
            remote_groups.find((group) => group.source_id === source.source_id),
        )
        .filter((group): group is CommandPaletteGroupResult => group !== undefined)
        .filter((group) => group.matches.length > 0 || group.is_loading),
    [sources, local_groups, remote_groups],
  );
}

function useLocalGroups(sources: readonly CommandPaletteSource[], query_text: string) {
  return useMemo(() => {
    return sources
      .filter((source) => source.resolves_from === 'local')
      .map((source) => {
        const matches = source.find_matches({
          query_text,
          signal: new AbortController().signal,
        });
        return {
          source_id: source.source_id,
          group_label: source.group_label,
          matches: Array.isArray(matches) ? matches : [],
          is_loading: false,
        } satisfies CommandPaletteGroupResult;
      });
  }, [sources, query_text]);
}

function useRemoteGroups(sources: readonly CommandPaletteSource[], query_text: string) {
  const [groups, set_groups] = useState<CommandPaletteGroupResult[]>([]);
  const remote_sources = useMemo(
    () => sources.filter((source) => source.resolves_from === 'remote'),
    [sources],
  );

  useEffect(() => {
    if (query_text.trim().length === 0) {
      set_groups((current) => (current.length === 0 ? current : []));
      return;
    }

    set_groups(remote_sources.map(pending_group));
    const abort_controller = new AbortController();
    const debounce_timer = setTimeout(() => {
      for (const source of remote_sources) {
        resolve_remote_group(source, query_text, abort_controller.signal, set_groups);
      }
    }, remote_search_debounce_ms);

    return () => {
      clearTimeout(debounce_timer);
      abort_controller.abort();
    };
  }, [remote_sources, query_text]);

  return groups;
}

async function resolve_remote_group(
  source: CommandPaletteSource,
  query_text: string,
  signal: AbortSignal,
  set_groups: React.Dispatch<React.SetStateAction<CommandPaletteGroupResult[]>>,
) {
  try {
    const matches = await source.find_matches({ query_text, signal });
    if (signal.aborted) return;
    set_groups((current) =>
      replace_group(current, { ...pending_group(source), matches, is_loading: false }),
    );
  } catch (error) {
    if (signal.aborted) return;
    console.error(`Command palette source "${source.source_id}" failed`, error);
    set_groups((current) =>
      replace_group(current, { ...pending_group(source), matches: [], is_loading: false }),
    );
  }
}

function pending_group(source: CommandPaletteSource): CommandPaletteGroupResult {
  return {
    source_id: source.source_id,
    group_label: source.group_label,
    matches: [],
    is_loading: true,
  };
}

function replace_group(
  groups: CommandPaletteGroupResult[],
  replacement: CommandPaletteGroupResult,
) {
  return groups.map((group) => (group.source_id === replacement.source_id ? replacement : group));
}
