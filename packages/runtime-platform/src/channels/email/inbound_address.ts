import { randomInt } from 'node:crypto';
import { env } from '@coworker/config';
import { AppError } from '@coworker/shared';
import { z } from 'zod';

export const inbound_email_username_schema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/, {
    message:
      'Use 3-64 lowercase letters, numbers, dots, dashes, or underscores; start and end with a letter or number.',
  });

function inbound_email_domain(): string {
  const domain = env.INBOUND_EMAIL_DOMAIN;
  if (!domain) {
    throw new AppError(
      'inbound_email_domain_unconfigured',
      'INBOUND_EMAIL_DOMAIN is not set, so managed workspace email is unavailable.',
      500,
    );
  }
  return domain.toLowerCase();
}

export function build_inbound_email_address(username: string): string {
  return `${username.toLowerCase()}@${inbound_email_domain()}`;
}

export const reserved_inbound_email_usernames = new Set([
  'abuse',
  'admin',
  'administrator',
  'alfera',
  'billing',
  'contact',
  'help',
  'hostmaster',
  'info',
  'legal',
  'mail',
  'marketing',
  'no-reply',
  'noreply',
  'notifications',
  'postmaster',
  'privacy',
  'root',
  'sales',
  'security',
  'support',
  'team',
  'webmaster',
]);

const maximum_derived_username_length = 32;
const workspace_name_filler_words = new Set(['workspace', 'workspaces', 'team', 'org', 'inc']);

export function default_inbound_email_username(
  workspace_name: string,
  generate_fallback: () => string = generate_readable_username,
): string {
  const from_name = normalize_username_candidate(drop_filler_words(workspace_name)).slice(
    0,
    maximum_derived_username_length,
  );
  const candidate = inbound_email_username_schema.safeParse(trim_separators(from_name));
  if (candidate.success && !reserved_inbound_email_usernames.has(candidate.data)) {
    return candidate.data;
  }
  return inbound_email_username_schema.parse(generate_fallback());
}

function drop_filler_words(workspace_name: string): string {
  const words = workspace_name.trim().split(/\s+/u);
  while (words.length > 1) {
    const last =
      words
        .at(-1)
        ?.toLowerCase()
        .replace(/[^a-z]/gu, '') ?? '';
    if (!workspace_name_filler_words.has(last)) break;
    words.pop();
  }
  return words.join(' ');
}

const readable_username_adjectives = [
  'amber',
  'brisk',
  'clear',
  'early',
  'golden',
  'quiet',
  'rapid',
  'solid',
];
const readable_username_nouns = [
  'anchor',
  'beacon',
  'canyon',
  'harbor',
  'meadow',
  'compass',
  'summit',
  'willow',
];

export function generate_readable_username(): string {
  const adjective = pick_random(readable_username_adjectives);
  const noun = pick_random(readable_username_nouns);
  return `${adjective}-${noun}-${randomInt(10, 100)}`;
}

function pick_random<Item>(items: readonly Item[]): Item {
  const item = items[randomInt(0, items.length)];
  if (item === undefined) throw new Error('word list must not be empty');
  return item;
}

function normalize_username_candidate(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64)
    .replace(/[._-]+$/g, '');
}

function trim_separators(value: string): string {
  return value.replace(/^[._-]+|[._-]+$/g, '');
}

export type ParsedEmailAddress = {
  email: string;
  display_name?: string;
};

export function parse_email_address(raw: string): ParsedEmailAddress | null {
  const bracketed = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (bracketed?.[2]) {
    const display_name = bracketed[1]?.trim();
    return {
      email: bracketed[2].toLowerCase(),
      ...(display_name ? { display_name } : {}),
    };
  }

  const bare = raw.trim();
  if (/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(bare)) return { email: bare.toLowerCase() };
  return null;
}

export function read_inbound_email_username(address: string): string | null {
  const parsed = parse_email_address(address);
  if (!parsed) return null;
  const [local_part, domain] = parsed.email.split('@');
  if (!local_part || domain !== inbound_email_domain()) return null;

  const separator_index = local_part.indexOf('+');
  return separator_index < 1 ? local_part : local_part.slice(0, separator_index);
}
