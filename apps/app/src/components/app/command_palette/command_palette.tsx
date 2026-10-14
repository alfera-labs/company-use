import {
  CommandPaletteAutocomplete,
  CommandPaletteEmpty,
  CommandPaletteGroup,
  CommandPaletteGroupLabel,
  CommandPaletteInput,
  CommandPaletteInputRow,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPalette as CommandPaletteRoot,
  CommandPaletteSurface,
} from '@coworker/ui/components/command-palette';
import { MatchText, read_text_runs_string } from '@coworker/ui/components/text-runs';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { create_chat_command_palette_sources } from '@/components/app/command_palette/chat_command_palette_sources';
import type {
  CommandPaletteGroupResult,
  CommandPaletteMatch,
} from '@/components/app/command_palette/command_palette_source';
import { useCommandPaletteStore } from '@/components/app/command_palette/command_palette_store';
import { merge_command_palette_groups } from '@/components/app/command_palette/match_chat_titles';
import { create_project_command_palette_source } from '@/components/app/command_palette/project_command_palette_source';
import { create_settings_command_palette_source } from '@/components/app/command_palette/settings_command_palette_source';
import { useCommandPaletteMatches } from '@/components/app/command_palette/use_command_palette_matches';
import { list_sessions } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function CommandPalette() {
  const navigate = useNavigate();
  const is_open = useCommandPaletteStore((state) => state.is_open);
  const set_command_palette_open = useCommandPaletteStore(
    (state) => state.set_command_palette_open,
  );
  const close_command_palette = useCommandPaletteStore((state) => state.close_command_palette);
  const [query_text, set_query_text] = useState('');

  const sessions_query = useQuery({
    queryKey: query_keys.sessions(),
    queryFn: list_sessions,
    enabled: is_open,
  });

  const palette_sources = useMemo(
    () => [
      ...create_chat_command_palette_sources({
        sessions: sessions_query.data ?? [],
        open_chat: (session_id) => navigate({ href: `/chats/${session_id}` }),
      }),
      create_settings_command_palette_source((path) => navigate({ href: path })),
      create_project_command_palette_source(() => navigate({ to: '/projects' })),
    ],
    [sessions_query.data, navigate],
  );

  const matched_groups = useCommandPaletteMatches(palette_sources, query_text);
  const groups = useMemo(() => merge_command_palette_groups(matched_groups), [matched_groups]);

  function choose_match(match: CommandPaletteMatch) {
    close_command_palette();
    match.open_match();
  }

  function change_open_state(next_is_open: boolean) {
    set_command_palette_open(next_is_open);
    if (!next_is_open) set_query_text('');
  }

  return (
    <CommandPaletteRoot open={is_open} onOpenChange={change_open_state}>
      <CommandPalettePanel
        groups={groups}
        query_text={query_text}
        set_query_text={set_query_text}
        choose_match={choose_match}
      />
    </CommandPaletteRoot>
  );
}

function close_on_escape(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Escape') useCommandPaletteStore.getState().close_command_palette();
}

/**
 * The search field with its results. Escape closes it at once: the field alone would use the
 * first Escape to clear the typed text, and only the second one would close.
 */
export function CommandPalettePanel({
  groups,
  query_text,
  set_query_text,
  choose_match,
}: {
  groups: CommandPaletteGroupResult[];
  query_text: string;
  set_query_text: (query_text: string) => void;
  choose_match: (match: CommandPaletteMatch) => void;
}) {
  return (
    <CommandPaletteSurface aria-label="Search" onKeyDownCapture={close_on_escape}>
      <CommandPaletteAutocomplete
        // Base UI is told not to filter: these results were already resolved, and half of them
        // came from the server where the matching happened.
        mode="none"
        items={groups.map((group) => group.matches)}
        value={query_text}
        onValueChange={set_query_text}
        autoHighlight="always"
      >
        <CommandPaletteInputRow>
          <CommandPaletteInput aria-label="Search" autoFocus placeholder="Search" />
        </CommandPaletteInputRow>

        <CommandPaletteList>
          {groups.map((group) => (
            <MatchGroup group={group} key={group.source_id} onChoose={choose_match} />
          ))}
          <CommandPaletteEmpty>{empty_message(query_text, groups)}</CommandPaletteEmpty>
        </CommandPaletteList>
      </CommandPaletteAutocomplete>
    </CommandPaletteSurface>
  );
}

function MatchGroup({
  group,
  onChoose,
}: {
  group: CommandPaletteGroupResult;
  onChoose: (match: CommandPaletteMatch) => void;
}) {
  return (
    <CommandPaletteGroup items={group.matches}>
      <CommandPaletteGroupLabel>
        <span className="flex items-center gap-2.5">
          {group.group_label}
          {group.matches.length > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
              {group.matches.length}
            </span>
          ) : null}
          {group.is_loading ? (
            <Loader2 aria-label="Searching" className="size-3 animate-spin" role="status" />
          ) : null}
        </span>
      </CommandPaletteGroupLabel>
      {group.matches.map((match) => (
        <MatchRow key={match.match_id} match={match} onChoose={onChoose} />
      ))}
    </CommandPaletteGroup>
  );
}

function MatchRow({
  match,
  onChoose,
}: {
  match: CommandPaletteMatch;
  onChoose: (match: CommandPaletteMatch) => void;
}) {
  const MatchIcon = match.icon;

  return (
    <CommandPaletteItem
      value={match}
      aria-label={read_text_runs_string(match.title_runs)}
      onClick={() => onChoose(match)}
    >
      <MatchIcon className="size-4 shrink-0 self-center text-muted-foreground/70" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-3">
          <MatchText
            className="truncate [&_mark]:bg-[#fff1a8] [&_mark]:font-normal dark:[&_mark]:bg-[#6b5715]"
            runs={match.title_runs}
          />
          {match.date_label ? (
            <span className="shrink-0 text-muted-foreground text-sm">{match.date_label}</span>
          ) : null}
        </span>
        {match.detail_runs === undefined ? null : (
          <MatchText
            className="truncate text-muted-foreground text-sm [&_mark]:bg-[#fff1a8] [&_mark]:font-normal dark:[&_mark]:bg-[#6b5715]"
            runs={match.detail_runs}
          />
        )}
      </span>
    </CommandPaletteItem>
  );
}

function empty_message(query_text: string, groups: CommandPaletteGroupResult[]) {
  if (query_text.trim().length === 0) return 'Search your chats by name, or by what was said.';
  if (groups.some((group) => group.is_loading)) return 'Searching…';
  return `No results match “${query_text.trim()}”.`;
}
