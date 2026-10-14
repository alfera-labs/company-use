import { create_logger, format_error_message } from '@coworker/shared';
import { z } from 'zod';

const log = create_logger('slack_click_payload');

export type SlackClickReply =
  | {
      response_type: 'ephemeral';
      replace_original: false;
      text: string;
    }
  | {
      replace_original: true;
      text: string;
      blocks: unknown[];
    };

export type SlackClickPress = {
  team_id: string;
  slack_user_id: string;
  action_id: string;
  value: string;
  original_blocks: unknown[];
  response_url?: string;
};

const block_actions_schema = z.object({
  type: z.literal('block_actions'),
  team: z.object({ id: z.string().min(1) }),
  user: z.object({ id: z.string().min(1) }),
  actions: z.array(z.object({ action_id: z.string(), value: z.string().min(1).optional() })).min(1),
  message: z.object({ blocks: z.array(z.unknown()).optional() }).optional(),
  response_url: z.string().url().optional(),
});

export function read_slack_click_press(body_text: string): SlackClickPress | null {
  const payload = new URLSearchParams(body_text).get('payload');
  if (!payload) return null;

  const parsed = block_actions_schema.safeParse(parse_json(payload));
  if (!parsed.success) return null;

  const action = parsed.data.actions.find((candidate) => candidate.value);
  if (!action?.value) return null;

  return {
    team_id: parsed.data.team.id,
    slack_user_id: parsed.data.user.id,
    action_id: action.action_id,
    value: action.value,
    original_blocks: parsed.data.message?.blocks ?? [],
    ...(parsed.data.response_url ? { response_url: parsed.data.response_url } : {}),
  };
}

// The press is answered through response_url, never through the HTTP response body: Slack ignores
// the body of a block_actions acknowledgement, so an answer sent there is recorded and
// changes nothing the person sees. The body is kept only as the fallback for a payload
// that carried no response_url.
const slack_answer_hosts = new Set(['hooks.slack.com', 'hooks.slack-gov.com']);

/**
 * Slack hands an answer address with each button press, and it is always one of Slack's own
 * over https. Any other address is not posted to: the API sits next to the database, and an
 * address in a payload must not be a way to make it call a service inside the network.
 */
export function is_a_slack_answer_address(response_url: string): boolean {
  if (!URL.canParse(response_url)) return false;
  const address = new URL(response_url);
  return address.protocol === 'https:' && slack_answer_hosts.has(address.hostname);
}

export async function deliver_the_answer(
  press: { response_url?: string | undefined },
  answer: SlackClickReply | null,
): Promise<SlackClickReply | null> {
  if (!answer || !press.response_url) return answer;
  if (!is_a_slack_answer_address(press.response_url)) return answer;
  try {
    await fetch(press.response_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(answer),
      signal: AbortSignal.timeout(2_500),
    });
    return null;
  } catch (error) {
    log.warn('a Slack answer could not be posted to response_url', {
      error: format_error_message(error),
    });
    return answer;
  }
}

export function answer_on_the_card(
  press: { original_blocks: unknown[] },
  outcome: string,
): SlackClickReply {
  if (press.original_blocks.length === 0) return ephemeral_reply(outcome);
  const kept = press.original_blocks.filter(
    (block) => (block as { type?: string }).type !== 'actions',
  );
  return {
    replace_original: true,
    text: outcome,
    blocks: [...kept, { type: 'context', elements: [{ type: 'mrkdwn', text: outcome }] }],
  };
}

export function ephemeral_reply(text: string): SlackClickReply {
  return { response_type: 'ephemeral', replace_original: false, text };
}

function parse_json(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
