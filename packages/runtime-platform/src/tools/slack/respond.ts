import { create_logger, format_error_message } from '@coworker/shared';
import { slack_message_text_from_markdown } from '@runtime-platform/channels/slack/message_format';
import { read_trusted_slack_turn_context } from '@runtime-platform/channels/slack/turn_context';
import {
  delete_slack_turn_stream,
  finish_slack_turn_stream,
} from '@runtime-platform/channels/slack/turn_stream';
import { create_slack_web_api } from '@runtime-platform/channels/slack/web_api';
import type {
  RuntimeToolDefinition,
  RuntimeToolExecutionContext,
} from '@runtime-platform/tools/types';
import type { WebClient } from '@slack/web-api';
import { z } from 'zod';

const slack_response_schema = z.strictObject({
  resolution_type: z.literal('reply'),
  message: z.string().min(1),
  // Slack rejects more than 50 blocks; cap here so an over-eager reply fails validation with a
  // clear message (and the required text stays as the fallback) instead of erroring mid-send.
  blocks: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
  reply_broadcast: z.boolean().optional(),
  keep_working: z.boolean().optional(),
});

type SlackResponse = z.infer<typeof slack_response_schema>;

const log = create_logger('slack_respond');

export const slack_respond_tool: RuntimeToolDefinition<typeof slack_response_schema> = {
  node_key: 'slack-respond-1',
  node_name: 'respond',
  display_name: 'Respond in Slack',
  description:
    'Sends one message to the trusted current Slack thread right now. Every accepted Slack turn MUST end by calling this tool — plain assistant text is never delivered, so until it succeeds the person has heard nothing. A normal reply ENDS your turn, so for a quick answer just reply once and do not narrate that you sent it. For longer or multi-step work, keep the person in the loop: post short progress updates as you go with keep_working: true — each is delivered to Slack immediately and the turn stays open so you can keep working — then send your final reply normally to finish. You may also call it several times in one turn to send multiple messages.',
  category: 'communication',
  input_schema: {
    type: 'object',
    properties: {
      resolution_type: { type: 'string', enum: ['reply'] },
      message: {
        type: 'string',
        description:
          'Complete Slack mrkdwn reply. Format links as <https://example.com|label> and bold as *text*. Also used as the notification and fallback text when blocks are set.',
      },
      blocks: {
        type: 'array',
        items: { type: 'object' },
        description:
          'Optional Slack Block Kit blocks for a richer reply (sections, dividers, context, buttons). When set, message is still required as the notification and fallback text.',
      },
      reply_broadcast: {
        type: 'boolean',
        description: 'Whether the threaded reply should also broadcast to the channel.',
      },
      keep_working: {
        type: 'boolean',
        description:
          'Set true ONLY when this is an interim update and you will keep working this turn. A normal reply ends your turn; keep_working keeps it open so you can continue and reply again.',
      },
    },
    required: ['resolution_type', 'message'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      accepted: { type: 'boolean' },
      resolution_type: { type: 'string', enum: ['reply'] },
      delivered: { type: 'boolean' },
      message_ts: { type: 'string' },
    },
    required: ['accepted', 'resolution_type', 'delivered'],
  },
  app_name: 'slack',
  required_connection: false,
  runtime_handler: 'slack.respond',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  available_on_source_types: ['slack'],
  metadata: {
    safe_for_first_milestone: true,
    policy_delegates_to_catalog: true,
    policy_labels: ['changes_things'],
    policy_exempt: true,
  },
  ends_run_on_success: true,
  validate_input: slack_response_schema,
  async execute(input, context) {
    const slack_turn = read_trusted_slack_turn_context(context?.source_context);
    if (!context || !slack_turn) return slack_turn_required_error();

    if (
      input.keep_working !== true &&
      !input.blocks &&
      !input.reply_broadcast &&
      slack_turn.stream_message_ts
    ) {
      const streamed = await finish_streamed_reply(input, context, slack_turn);
      if (streamed) return streamed;
    }

    const posted = await post_reply(input, context, slack_turn).catch(format_error_message);
    if (typeof posted === 'string') {
      return { success: false as const, error: { code: 'slack_reply_failed', message: posted } };
    }
    return accepted_response(input, {
      delivered: true,
      ...(posted.ts ? { message_ts: posted.ts } : {}),
    });
  },
};

async function post_reply(
  input: SlackResponse,
  context: RuntimeToolExecutionContext,
  slack_turn: NonNullable<ReturnType<typeof read_trusted_slack_turn_context>>,
) {
  const slack_api = await create_slack_web_api(
    context.db,
    context.workspace_id,
    slack_turn.connection_id,
  );
  const posted = await slack_api.chat.postMessage({
    channel: slack_turn.channel_id,
    thread_ts: slack_turn.thread_ts,
    text: slack_message_text_from_markdown(input.message),
    ...(input.blocks ? { blocks: input.blocks } : {}),
    ...(input.reply_broadcast === undefined ? {} : { reply_broadcast: input.reply_broadcast }),
    unfurl_links: false,
    unfurl_media: false,
  } as Parameters<WebClient['chat']['postMessage']>[0]);
  if (input.keep_working !== true && slack_turn.stream_message_ts) {
    await delete_slack_turn_stream(slack_api, {
      channel_id: slack_turn.channel_id,
      message_ts: slack_turn.stream_message_ts,
    });
  }
  return posted;
}

async function finish_streamed_reply(
  input: SlackResponse,
  context: RuntimeToolExecutionContext,
  slack_turn: NonNullable<ReturnType<typeof read_trusted_slack_turn_context>>,
) {
  try {
    const slack_api = await create_slack_web_api(
      context.db,
      context.workspace_id,
      slack_turn.connection_id,
    );
    const response = await finish_slack_turn_stream(
      slack_api,
      {
        channel_id: slack_turn.channel_id,
        message_ts: slack_turn.stream_message_ts as string,
      },
      { text: input.message },
    );
    return accepted_response(input, {
      delivered: true,
      message_ts: response.ts,
    });
  } catch (error) {
    log.error('Slack streamed reply failed; using the normal message sender', {
      workspace_id: context.workspace_id,
      run_id: context.run_id,
      channel_id: slack_turn.channel_id,
      error: format_error_message(error),
    });
    return null;
  }
}
function slack_turn_required_error() {
  return {
    success: false as const,
    error: {
      code: 'slack_turn_required',
      message: 'slack-respond-1 is valid only during a trusted Slack-origin turn.',
    },
  };
}

function accepted_response(
  response: SlackResponse,
  delivery: { delivered: boolean; message_ts?: string },
) {
  const keep_working = response.keep_working === true;
  return {
    success: true as const,
    data: {
      accepted: true,
      resolution_type: response.resolution_type,
      ...delivery,
    },
    ...(keep_working ? { ends_run: false } : {}),
  };
}
