import type { TextRun } from '@coworker/ui/components/text-runs';
import type { CommandPaletteGroupResult } from '@/components/app/command_palette/command_palette_source';
import type { Session } from '@/lib/api';

export const chat_title_match_limit = 6;

export function merge_command_palette_groups(
  groups: CommandPaletteGroupResult[],
): CommandPaletteGroupResult[] {
  const merged_groups = new Map<string, CommandPaletteGroupResult>();

  for (const group of groups) {
    const current = merged_groups.get(group.group_label);
    if (!current) {
      merged_groups.set(group.group_label, group);
      continue;
    }

    const matches = new Map(current.matches.map((match) => [match.match_id, match]));
    for (const match of group.matches) matches.set(match.match_id, match);
    merged_groups.set(group.group_label, {
      ...current,
      matches: [...matches.values()],
      is_loading: current.is_loading || group.is_loading,
    });
  }

  return [...merged_groups.values()];
}

export function find_sessions_matching_title(
  sessions: readonly Session[],
  query_text: string,
): Session[] {
  const needle = query_text.trim().toLowerCase();
  if (needle.length === 0) return [];

  return sessions
    .filter((session) => read_session_title(session).toLowerCase().includes(needle))
    .slice(0, chat_title_match_limit);
}

export function read_session_title(session: Session) {
  return session.session_title ?? 'Untitled chat';
}

export function split_title_into_runs(title: string, query_text: string): TextRun[] {
  const needle = query_text.trim();
  if (needle.length === 0) return [{ text: title, is_match: false }];

  const runs: TextRun[] = [];
  const lowercase_title = title.toLowerCase();
  const lowercase_needle = needle.toLowerCase();
  let cursor = 0;

  while (cursor < title.length) {
    const match_start = lowercase_title.indexOf(lowercase_needle, cursor);
    if (match_start === -1) break;

    if (match_start > cursor) {
      runs.push({ text: title.slice(cursor, match_start), is_match: false });
    }
    runs.push({ text: title.slice(match_start, match_start + needle.length), is_match: true });
    cursor = match_start + needle.length;
  }

  if (cursor < title.length) runs.push({ text: title.slice(cursor), is_match: false });
  return runs;
}
