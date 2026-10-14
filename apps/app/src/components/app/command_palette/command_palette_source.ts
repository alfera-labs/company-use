import type { TextRun } from '@coworker/ui/components/text-runs';
import type { ComponentType } from 'react';

export type CommandPaletteMatch = {
  match_id: string;
  title_runs: readonly TextRun[];
  detail_runs?: readonly TextRun[];
  date_label?: string;
  icon: ComponentType<{ className?: string }>;
  open_match: () => void;
};

type CommandPaletteQuery = {
  query_text: string;
  signal: AbortSignal;
};

export type CommandPaletteSource = {
  source_id: string;
  group_label: string;
  resolves_from: 'local' | 'remote';
  find_matches: (
    query: CommandPaletteQuery,
  ) => readonly CommandPaletteMatch[] | Promise<readonly CommandPaletteMatch[]>;
};

export type CommandPaletteGroupResult = {
  source_id: string;
  group_label: string;
  matches: readonly CommandPaletteMatch[];
  is_loading: boolean;
};
