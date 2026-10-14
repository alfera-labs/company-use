import { read_connection_credential_value } from '@coworker/core/integrations/credential_envelope';
import type { SlackEventConnection } from '@runtime-platform/channels/slack/channel_event_dispatch';
import { WebClient } from '@slack/web-api';

const slack_processing_reaction_name = 'hourglass_flowing_sand';

type SlackReactionTarget = {
  channel_id: string;
  event_ts: string;
};

type SlackReactionInput = {
  token: string;
  channel_id: string;
  timestamp: string;
  name: string;
};

export type SlackReactionOptions = {
  add_reaction?: (input: SlackReactionInput) => Promise<void>;
  remove_reaction?: (input: SlackReactionInput) => Promise<void>;
};

export async function add_slack_processing_reaction(
  connection: SlackEventConnection,
  target: SlackReactionTarget,
  options: SlackReactionOptions = {},
) {
  await run_slack_processing_reaction(
    connection,
    target,
    options.add_reaction ?? add_slack_reaction,
  );
}

export async function add_slack_processing_reaction_with_client(
  slack_api: WebClient,
  target: SlackReactionTarget,
) {
  try {
    await slack_api.reactions.add({
      channel: target.channel_id,
      timestamp: target.event_ts,
      name: slack_processing_reaction_name,
    });
  } catch {
    return;
  }
}

export async function remove_slack_processing_reaction(
  connection: SlackEventConnection,
  target: SlackReactionTarget,
  options: SlackReactionOptions = {},
) {
  await run_slack_processing_reaction(
    connection,
    target,
    options.remove_reaction ?? remove_slack_reaction,
  );
}

async function run_slack_processing_reaction(
  connection: SlackEventConnection,
  target: SlackReactionTarget,
  operation: (input: SlackReactionInput) => Promise<void>,
) {
  const token = read_slack_bot_token(connection);
  if (!token) return;

  try {
    await operation({
      token,
      channel_id: target.channel_id,
      timestamp: target.event_ts,
      name: slack_processing_reaction_name,
    });
  } catch {
    return;
  }
}

async function add_slack_reaction(input: SlackReactionInput) {
  await new WebClient(input.token, {
    rejectRateLimitedCalls: true,
    retryConfig: { retries: 0 },
    timeout: 1_500,
  }).reactions.add({
    channel: input.channel_id,
    timestamp: input.timestamp,
    name: input.name,
  });
}

async function remove_slack_reaction(input: SlackReactionInput) {
  await new WebClient(input.token).reactions.remove({
    channel: input.channel_id,
    timestamp: input.timestamp,
    name: input.name,
  });
}

function read_slack_bot_token(connection: SlackEventConnection) {
  if (!connection.credentials) return null;
  return (
    read_connection_credential_value(connection.credentials, 'bot_token') ??
    read_connection_credential_value(connection.credentials, 'access_token')
  );
}
