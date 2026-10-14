import { chat_respond_node_key, type JsonSchema } from '@coworker/shared';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const answer_limit = 300;
const details_limit = 450;
const next_limit = 160;
const deliverable_limit = 3000;

const too_long = (field: string, limit: number, cut: string) =>
  `${field} is over ${limit} characters. Cut it and call chat-respond-1 again: ${cut}`;

export const chat_respond_input_schema = z.strictObject({
  answer: z
    .string()
    .trim()
    .min(1)
    .max(
      answer_limit,
      too_long('answer', answer_limit, 'state the outcome in one or two sentences.'),
    ),
  details: z
    .string()
    .trim()
    .max(
      details_limit,
      too_long('details', details_limit, 'keep only what they need to act, as counts not lists.'),
    )
    .optional(),
  deliverable: z
    .string()
    .trim()
    .max(
      deliverable_limit,
      too_long(
        'deliverable',
        deliverable_limit,
        'write longer work to a file and say where it is.',
      ),
    )
    .optional(),
  next: z
    .string()
    .trim()
    .max(next_limit, too_long('next', next_limit, 'one next step in one line.'))
    .optional(),
});

type ChatReply = z.infer<typeof chat_respond_input_schema>;

export function render_chat_reply(reply: ChatReply) {
  return [reply.answer, reply.details, reply.deliverable, reply.next]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

export const chat_respond_tool: RuntimeToolDefinition<typeof chat_respond_input_schema> = {
  node_key: chat_respond_node_key,
  node_name: 'respond',
  display_name: 'Reply',
  description:
    'Sends your reply to the person in this chat and ends your turn. Every chat turn ends with one call. ' +
    'answer: the outcome in one or two sentences, first. details: only what they need to act on it, as counts not lists, no account of how you checked. ' +
    'deliverable: only something they asked you to write for them, such as a draft message, a table of their data or a document. Ideas, options, plans, capabilities and explanations are never a deliverable: they go in answer and details, as the two or three that matter most. ' +
    'next: at most one next step. Do not write the reply as plain text as well.',
  category: 'communication',
  input_schema: z.toJSONSchema(chat_respond_input_schema, {
    target: 'draft-7',
    io: 'input',
  }) as JsonSchema,
  output_schema: {
    type: 'object',
    properties: { delivered: { type: 'boolean' } },
    required: ['delivered'],
  },
  app_name: 'chat',
  required_connection: false,
  runtime_handler: 'chat.respond',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  available_on_source_types: ['dashboard'],
  ends_run_on_success: true,
  validate_input: chat_respond_input_schema,
  async execute(input) {
    return { success: true, data: { delivered: true }, reply_text: render_chat_reply(input) };
  },
};
