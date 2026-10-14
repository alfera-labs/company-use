import type { CommandPaletteSource } from '@/components/app/command_palette/command_palette_source';
import { split_title_into_runs } from '@/components/app/command_palette/match_chat_titles';
import { app_page_definitions } from '@/lib/app_navigation';
import { settings_section_definitions, settings_section_path } from '@/lib/settings_navigation';

const usage_page = app_page_definitions.find((page) => page.page_id === 'usage');

export function create_settings_command_palette_source(
  open_settings: (path: string) => void,
): CommandPaletteSource {
  return {
    source_id: 'settings',
    group_label: 'Settings',
    resolves_from: 'local',
    find_matches: ({ query_text }) => {
      const query = query_text.trim().toLowerCase();
      const settings_matches = settings_section_definitions.map((section) => ({
        match_id: `settings:${section.section_id}`,
        title_runs: split_title_into_runs(section.title, query_text),
        title: section.title,
        icon: section.icon,
        open_match: () => open_settings(settings_section_path(section.section_id)),
      }));
      const matches = usage_page
        ? [
            {
              match_id: 'settings:usage',
              title_runs: split_title_into_runs(usage_page.title, query_text),
              title: usage_page.title,
              icon: usage_page.icon,
              open_match: () => open_settings(usage_page.path),
            },
            ...settings_matches,
          ]
        : settings_matches;
      return matches
        .filter((match) => query.length === 0 || match.title.toLowerCase().includes(query))
        .map(({ title: _title, ...match }) => match);
    },
  };
}
