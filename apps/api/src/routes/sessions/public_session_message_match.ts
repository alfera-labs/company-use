import {
  match_end_marker,
  match_start_marker,
  type SessionMessageMatchRow,
} from '@coworker/core/db/queries/session_message_search';

export type SnippetRun = {
  text: string;
  is_match: boolean;
};

export type PublicSessionMessageMatch = {
  session_id: string;
  session_title: string | null;
  session_source: string;
  matched_message_sequence: number;
  last_message_time: string | null;
  snippet_runs: SnippetRun[];
};

export function public_session_message_match(
  row: SessionMessageMatchRow,
): PublicSessionMessageMatch {
  return {
    session_id: row.session_id,
    session_title: row.session_title,
    session_source: row.session_source,
    matched_message_sequence: Number(row.matched_message_sequence),
    last_message_time: format_time(row.last_message_time),
    snippet_runs: split_snippet_into_runs(row.snippet),
  };
}

export function split_snippet_into_runs(snippet: string): SnippetRun[] {
  const runs: SnippetRun[] = [];
  let cursor = 0;

  while (cursor < snippet.length) {
    const match_start = snippet.indexOf(match_start_marker, cursor);
    if (match_start === -1) break;
    const match_end = snippet.indexOf(match_end_marker, match_start + match_start_marker.length);
    if (match_end === -1) break;

    append_run(runs, snippet.slice(cursor, match_start), false);
    append_run(runs, snippet.slice(match_start + match_start_marker.length, match_end), true);
    cursor = match_end + match_end_marker.length;
  }

  append_run(runs, snippet.slice(cursor), false);
  return runs;
}

function append_run(runs: SnippetRun[], text: string, is_match: boolean) {
  const cleaned_text = remove_markdown_marks(remove_match_markers(text));
  if (cleaned_text.length === 0) return;
  runs.push({ text: cleaned_text, is_match });
}

function remove_markdown_marks(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\*\*|__|~~|`/gu, '')
    .replace(/(^|\n)\s*(#{1,6}|>)\s+/gu, '$1')
    .replace(/:?-{3,}:?/gu, '')
    .replace(/[ \t]*\|[ \t|]*/gu, ' ');
}

function remove_match_markers(text: string) {
  return text.replaceAll(match_start_marker, '').replaceAll(match_end_marker, '');
}

function format_time(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
