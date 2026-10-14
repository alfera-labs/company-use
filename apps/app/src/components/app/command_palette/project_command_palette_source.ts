import { FolderPlus } from 'lucide-react';
import type { CommandPaletteSource } from '@/components/app/command_palette/command_palette_source';

export function create_project_command_palette_source(
  open_new_project: () => void,
): CommandPaletteSource {
  return {
    source_id: 'project_actions',
    group_label: 'Actions',
    resolves_from: 'local',
    find_matches: ({ query_text }) => {
      const query = query_text.trim().toLowerCase();
      if (query.length === 0) return [];
      if (!'new project create project'.includes(query)) return [];
      return [
        {
          match_id: 'action:new_project',
          title_runs: [{ text: 'New project', is_match: query.length > 0 }],
          detail_runs: [{ text: 'Create a shared project', is_match: false }],
          icon: FolderPlus,
          open_match: open_new_project,
        },
      ];
    },
  };
}
