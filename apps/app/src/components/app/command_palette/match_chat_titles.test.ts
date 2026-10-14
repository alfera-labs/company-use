import { describe, expect, it } from 'vitest';
import {
  chat_title_match_limit,
  find_sessions_matching_title,
  merge_command_palette_groups,
  split_title_into_runs,
} from '@/components/app/command_palette/match_chat_titles';
import type { Session } from '@/lib/api';

function session(session_title: string | null, session_id = session_title ?? 'none'): Session {
  return { session_id, session_title } as Session;
}

describe('find_sessions_matching_title', () => {
  it('matches regardless of case', () => {
    const sessions = [session('Stripe webhook debugging'), session('Weekly plan')];

    expect(find_sessions_matching_title(sessions, 'STRIPE')).toHaveLength(1);
    expect(find_sessions_matching_title(sessions, 'stripe')).toHaveLength(1);
  });

  it('matches inside the title, not only at the start', () => {
    expect(
      find_sessions_matching_title([session('Debugging the webhook')], 'webhook'),
    ).toHaveLength(1);
  });

  it('returns nothing for blank input', () => {
    const sessions = [session('Stripe webhook debugging')];

    expect(find_sessions_matching_title(sessions, '')).toEqual([]);
    expect(find_sessions_matching_title(sessions, '   ')).toEqual([]);
  });

  it('finds chats that were never given a name, by their placeholder', () => {
    expect(find_sessions_matching_title([session(null, 'ses_1')], 'untitled')).toHaveLength(1);
  });

  it('caps how many titles it returns so the remote group stays reachable', () => {
    const sessions = Array.from({ length: chat_title_match_limit + 4 }, (_unused, index) =>
      session(`Deployment ${index}`, `ses_${index}`),
    );

    expect(find_sessions_matching_title(sessions, 'deployment')).toHaveLength(
      chat_title_match_limit,
    );
  });
});

describe('split_title_into_runs', () => {
  it('marks the matched part of the title and leaves the rest alone', () => {
    expect(split_title_into_runs('Stripe webhook debugging', 'webhook')).toEqual([
      { text: 'Stripe ', is_match: false },
      { text: 'webhook', is_match: true },
      { text: ' debugging', is_match: false },
    ]);
  });

  it('keeps the original casing inside the marked run', () => {
    expect(split_title_into_runs('Stripe webhook', 'STRIPE')).toEqual([
      { text: 'Stripe', is_match: true },
      { text: ' webhook', is_match: false },
    ]);
  });

  it('marks every occurrence, not only the first', () => {
    expect(split_title_into_runs('deploy then deploy', 'deploy')).toEqual([
      { text: 'deploy', is_match: true },
      { text: ' then ', is_match: false },
      { text: 'deploy', is_match: true },
    ]);
  });

  it('returns the whole title as one unmatched run when nothing matches', () => {
    expect(split_title_into_runs('Weekly plan', 'stripe')).toEqual([
      { text: 'Weekly plan', is_match: false },
    ]);
  });

  it('returns the title unmarked for blank input', () => {
    expect(split_title_into_runs('Weekly plan', '  ')).toEqual([
      { text: 'Weekly plan', is_match: false },
    ]);
  });
});

describe('merge_command_palette_groups', () => {
  it('keeps one chat row and prefers the content match', () => {
    const icon = () => null;
    const title_match = {
      match_id: 'chat:one',
      title_runs: [{ text: 'Italian', is_match: true }],
      icon,
      open_match: () => undefined,
    };
    const content_match = {
      ...title_match,
      detail_runs: [{ text: 'Italian peninsula', is_match: true }],
    };

    const groups = merge_command_palette_groups([
      { source_id: 'titles', group_label: 'Chats', matches: [title_match], is_loading: false },
      { source_id: 'messages', group_label: 'Chats', matches: [content_match], is_loading: false },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.matches).toEqual([content_match]);
  });
});
