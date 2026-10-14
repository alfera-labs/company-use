import { type UsersListResponse, WebClient } from '@slack/web-api';

export type SlackMember = {
  user_id: string;
  real_name: string | null;
  display_name: string | null;
  email: string | null;
  timezone: string | null;
  is_bot: boolean;
  is_guest: boolean;
};

export type SlackUserDirectory = {
  members: SlackMember[];
  name_by_id: Map<string, string>;
  truncated: boolean;
  loaded_pages: number;
};

const default_user_list_page_size = 200;
const max_user_list_pages = 25;
const directory_cache_ttl_ms = 5 * 60 * 1000;

type CachedDirectory = { directory: SlackUserDirectory; expires_at_ms: number };
const directory_cache = new Map<string, CachedDirectory>();

export async function load_slack_user_directory(
  token: string,
  now_ms: number = Date.now(),
  fetch: (token: string) => Promise<SlackUserDirectory> = fetch_slack_user_directory,
): Promise<SlackUserDirectory> {
  const cached = directory_cache.get(token);
  if (cached && cached.expires_at_ms > now_ms) return cached.directory;

  const directory = await fetch(token);
  directory_cache.set(token, { directory, expires_at_ms: now_ms + directory_cache_ttl_ms });
  drop_expired_directories(now_ms);
  return directory;
}

function drop_expired_directories(now_ms: number) {
  for (const [token, entry] of directory_cache) {
    if (entry.expires_at_ms <= now_ms) directory_cache.delete(token);
  }
}

export function clear_slack_user_directory_cache() {
  directory_cache.clear();
}

async function fetch_slack_user_directory(token: string): Promise<SlackUserDirectory> {
  const client = new WebClient(token);
  const members: SlackMember[] = [];
  const name_by_id = new Map<string, string>();
  let cursor: string | undefined;
  let pages = 0;

  do {
    const response = await client.users.list({
      limit: default_user_list_page_size,
      ...(cursor ? { cursor } : {}),
    });
    for (const raw of response.members ?? []) {
      const member = normalize_slack_member(raw);
      if (!member) continue;
      members.push(member);
      const name = member.real_name ?? member.display_name;
      if (name) name_by_id.set(member.user_id, name);
    }
    cursor = normalize_next_cursor(response.response_metadata?.next_cursor);
    pages += 1;
  } while (cursor && pages < max_user_list_pages);

  return { members, name_by_id, truncated: Boolean(cursor), loaded_pages: pages };
}

export function most_common_member_timezone(directory: SlackUserDirectory): string | null {
  const counts = new Map<string, number>();
  for (const member of directory.members) {
    if (member.is_bot || !member.timezone) continue;
    counts.set(member.timezone, (counts.get(member.timezone) ?? 0) + 1);
  }
  let best: string | null = null;
  let best_count = 0;
  for (const [timezone, count] of counts) {
    if (count > best_count) {
      best = timezone;
      best_count = count;
    }
  }
  return best;
}

export function resolve_mentions(text: string, name_by_id: Map<string, string>): string {
  return text.replace(/<@([A-Z0-9]+)>/g, (match, id) => {
    const name = name_by_id.get(id);
    return name ? `@${name}` : match;
  });
}

function normalize_slack_member(
  value: NonNullable<UsersListResponse['members']>[number],
): SlackMember | null {
  const user_id = value.id;
  if (!user_id) return null;
  if (value.deleted === true) return null;
  return {
    user_id,
    real_name: value.real_name || value.profile?.real_name || null,
    display_name: value.profile?.display_name || null,
    email: value.profile?.email || null,
    timezone: value.tz || null,
    is_bot: value.is_bot === true || user_id === 'USLACKBOT',
    is_guest: value.is_restricted === true || value.is_ultra_restricted === true,
  };
}

function normalize_next_cursor(value: string | undefined): string | undefined {
  return value || undefined;
}
