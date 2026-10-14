import {
  fetch_slack_channels,
  join_slack_channel,
} from '@runtime-platform/tools/slack/channels_api';
import { afterEach, describe, expect, it, vi } from 'vitest';

const slack_sdk = vi.hoisted(() => ({
  clients: [] as string[],
  conversations_list: vi.fn(),
  conversations_join: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    conversations = {
      list: slack_sdk.conversations_list,
      join: slack_sdk.conversations_join,
    };

    constructor(token: string) {
      slack_sdk.clients.push(token);
    }
  },
}));

describe('Slack channel settings API adapter', () => {
  afterEach(() => {
    slack_sdk.clients.length = 0;
    slack_sdk.conversations_list.mockReset();
    slack_sdk.conversations_join.mockReset();
  });

  it('lists public and private channels with explicit Slack conversation types', async () => {
    slack_sdk.conversations_list.mockResolvedValueOnce({
      ok: true,
      channels: [
        { id: 'C_GENERAL', name: 'general', is_private: false, is_member: true, num_members: 12 },
      ],
      response_metadata: { next_cursor: 'cursor_next' },
    });
    slack_sdk.conversations_list.mockResolvedValueOnce({
      ok: true,
      channels: [{ id: 'G_PRIVATE', name: 'leadership', is_private: true, is_member: true }],
      response_metadata: { next_cursor: '' },
    });

    const public_page = await fetch_slack_channels('xoxb-settings', {
      visibility: 'public',
      cursor: 'abc',
    });
    const private_page = await fetch_slack_channels('xoxb-settings', {
      visibility: 'private',
    });

    expect(public_page).toEqual({
      channels: [
        { id: 'C_GENERAL', name: 'general', is_private: false, is_member: true, num_members: 12 },
      ],
      next_cursor: 'cursor_next',
    });
    expect(private_page).toEqual({
      channels: [
        {
          id: 'G_PRIVATE',
          name: 'leadership',
          is_private: true,
          is_member: true,
          num_members: null,
        },
      ],
      next_cursor: null,
    });
    expect(slack_sdk.conversations_list).toHaveBeenNthCalledWith(1, {
      limit: 200,
      types: 'public_channel',
      exclude_archived: true,
      cursor: 'abc',
    });
    expect(slack_sdk.conversations_list).toHaveBeenNthCalledWith(2, {
      limit: 200,
      types: 'private_channel',
      exclude_archived: true,
    });
  });

  it('reads Slack join warnings as an already joined channel', async () => {
    slack_sdk.conversations_join.mockResolvedValue({
      ok: true,
      warning: 'already_in_channel',
      response_metadata: { warnings: ['already_in_channel'] },
    });

    const result = await join_slack_channel('xoxb-settings', 'C_GENERAL');

    expect(result).toEqual({ channel_id: 'C_GENERAL', already_in_channel: true });
    expect(slack_sdk.conversations_join).toHaveBeenCalledWith({ channel: 'C_GENERAL' });
  });
});
