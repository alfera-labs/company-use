import {
  clear_slack_user_directory_cache,
  load_slack_user_directory,
  resolve_mentions,
  type SlackUserDirectory,
} from '@runtime-platform/channels/slack/directory';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({ users_list: vi.fn() }));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { list: slack_sdk.users_list };
  },
}));

describe('resolve_mentions', () => {
  const names = new Map([
    ['U0EXAMPLE02', 'Otto Park'],
    ['U1', 'Robin'],
  ]);

  it('replaces <@id> mentions with names', () => {
    expect(resolve_mentions('<@U0EXAMPLE02> shipped the release', names)).toBe(
      '@Otto Park shipped the release',
    );
  });

  it('does not touch bare uppercase words that look like ids', () => {
    expect(resolve_mentions('the deploy UPDATED checkout', names)).toBe(
      'the deploy UPDATED checkout',
    );
  });

  it('leaves unknown ids untouched', () => {
    expect(resolve_mentions('<@U999NOTREAL> said hi', names)).toBe('<@U999NOTREAL> said hi');
  });

  it('resolves several mentions in one string', () => {
    expect(resolve_mentions('<@U1> and <@U0EXAMPLE02> paired', names)).toBe(
      '@Robin and @Otto Park paired',
    );
  });
});

describe('load_slack_user_directory (cache)', () => {
  const empty: SlackUserDirectory = {
    members: [],
    name_by_id: new Map(),
    truncated: false,
    loaded_pages: 1,
  };

  beforeEach(() => {
    clear_slack_user_directory_cache();
  });

  it('fetches once and serves the rest of a sweep from cache', async () => {
    const fetch = vi.fn(async () => empty);
    const t0 = 1_000_000;

    await load_slack_user_directory('xoxb-a', t0, fetch);
    await load_slack_user_directory('xoxb-a', t0 + 1000, fetch);
    await load_slack_user_directory('xoxb-a', t0 + 60_000, fetch);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has passed', async () => {
    const fetch = vi.fn(async () => empty);
    const t0 = 1_000_000;

    await load_slack_user_directory('xoxb-a', t0, fetch);
    await load_slack_user_directory('xoxb-a', t0 + 6 * 60 * 1000, fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caches per token so workspaces never share a directory', async () => {
    const fetch = vi.fn(async () => empty);
    const t0 = 1_000_000;

    await load_slack_user_directory('xoxb-a', t0, fetch);
    await load_slack_user_directory('xoxb-b', t0, fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('load_slack_user_directory (Slack users.list)', () => {
  beforeEach(() => {
    clear_slack_user_directory_cache();
    slack_sdk.users_list.mockReset();
  });

  it('marks single-channel and multi-channel guests, and nobody else', async () => {
    slack_sdk.users_list.mockResolvedValue({
      members: [
        { id: 'U1', real_name: 'Nina Boro', profile: { email: 'nina@northwind.com' } },
        { id: 'U2', real_name: 'Dana Agency', is_restricted: true },
        { id: 'U3', real_name: 'Sam Visitor', is_restricted: true, is_ultra_restricted: true },
        { id: 'U4', real_name: 'Full Member', is_restricted: false, is_ultra_restricted: false },
      ],
      response_metadata: { next_cursor: '' },
    });

    const directory = await load_slack_user_directory('xoxb-guests');

    expect(directory.members.map((member) => [member.user_id, member.is_guest])).toEqual([
      ['U1', false],
      ['U2', true],
      ['U3', true],
      ['U4', false],
    ]);
  });

  it('drops deleted Slack users and flags bots', async () => {
    slack_sdk.users_list.mockResolvedValue({
      members: [
        { id: 'U1', real_name: 'Nina Boro' },
        {
          id: 'UGONE',
          real_name: 'Left Us',
          deleted: true,
          profile: { email: 'left@northwind.com' },
        },
        { id: 'UBOT', real_name: 'Deploy Bot', is_bot: true },
        { id: 'USLACKBOT', real_name: 'Slackbot' },
      ],
      response_metadata: { next_cursor: '' },
    });

    const directory = await load_slack_user_directory('xoxb-deleted');

    expect(directory.members.map((member) => [member.user_id, member.is_bot])).toEqual([
      ['U1', false],
      ['UBOT', true],
      ['USLACKBOT', true],
    ]);
  });
});
