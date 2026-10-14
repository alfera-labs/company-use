import definition from '@connectors/apps/slack/list_channels/v1/node.json' with { type: 'json' };
import {
  find_next_cursor,
  type SlackEnvelope,
  throw_on_slack_error,
} from '@connectors/apps/slack/slack_envelope';
import { define_connector_execute } from '@connectors/define_connector_execute';
import type { JsonSchema } from '@coworker/shared';

type ListChannelsInput = {
  cursor?: string;
  limit?: number;
  exclude_archived?: boolean;
};

type ListChannelsOutput = {
  channels: { id: string; name: string | null; is_private: boolean; num_members: number | null }[];
  next_cursor: string | null;
};

type ConversationsListResponse = SlackEnvelope & {
  channels?: {
    id: string;
    name?: string;
    is_private?: boolean;
    num_members?: number;
  }[];
  response_metadata?: { next_cursor?: string };
};

const conversations_list = definition.requests.conversations_list;
const response_schema = conversations_list.response_schema as JsonSchema;

export const execute = define_connector_execute<ListChannelsInput, ListChannelsOutput>(
  async (input, context) => {
    const response = await context.send_request<ConversationsListResponse>({
      method: 'GET',
      path: conversations_list.path,
      query: {
        types: conversations_list.query.types,
        exclude_archived: input.exclude_archived ?? true,
        cursor: input.cursor,
        limit: input.limit,
      },
      response_schema,
    });
    throw_on_slack_error(response, 'conversations.list');

    return {
      channels: (response.channels ?? []).map((channel) => ({
        id: channel.id,
        name: channel.name ?? null,
        is_private: channel.is_private ?? false,
        num_members: channel.num_members ?? null,
      })),
      next_cursor: find_next_cursor(response.response_metadata),
    };
  },
);
