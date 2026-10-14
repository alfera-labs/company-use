import type { ApiKeyEnv } from '@api/lib/context';
import { parse_json_body } from '@api/lib/validate';
import { compat_model_id } from '@api/routes/compat/compat_models';
import {
  type CompatTurnResult,
  response_id_to_session_id,
  run_compat_turn,
} from '@api/routes/compat/compat_turn';
import {
  type CompatRole,
  type CompatTurn,
  conversation_to_text_blocks,
  extract_text,
  sse_headers,
  sse_stream,
  unix_seconds,
} from '@api/routes/compat/compat_wire';
import type { Context } from 'hono';
import { z } from 'zod';

// OpenAI Responses over the same session machinery. Its one durable feature maps straight onto a
// session: `previous_response_id` resumes the session the earlier response named, so a caller
// threads a conversation without re-sending its history.
//
// Honored: `input` (string or item array), `instructions` (folded in as context),
// `previous_response_id` (resumes the session), `stream`. Accepted and ignored: `model` (always
// `alfera`), `temperature`/`top_p`/`max_output_tokens` (the agent governs generation), `tools`/
// `tool_choice` (the agent runs its own tool surface), `text.format` json_schema (no per-turn
// response-format hook). Unknown fields pass through.

const input_item_schema = z
  .object({
    role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.array(z.unknown())]),
  })
  .loose();

const body_schema = z
  .object({
    input: z.union([z.string(), z.array(input_item_schema)]),
    instructions: z.string().optional(),
    previous_response_id: z.string().optional(),
    stream: z.boolean().optional(),
  })
  .loose();

export async function openai_responses(c: Context<ApiKeyEnv>): Promise<Response> {
  const body = await parse_json_body(c, body_schema);
  const result = await run_compat_turn(c.get('db'), {
    api_key: c.get('api_key'),
    content: conversation_to_text_blocks(input_turns(body)),
    resume_session_id: body.previous_response_id
      ? response_id_to_session_id(body.previous_response_id)
      : undefined,
    idempotency_key: c.req.header('idempotency-key')?.trim() || undefined,
    signal: c.req.raw.signal,
  });

  if (body.stream) {
    return c.body(sse_stream(response_stream_frames(result)), 200, sse_headers);
  }
  return c.json(response_body(result, 'completed'));
}

function input_turns(data: z.infer<typeof body_schema>): CompatTurn[] {
  const instructions: CompatTurn[] = data.instructions
    ? [{ role: 'system', text: data.instructions }]
    : [];
  if (typeof data.input === 'string') {
    return [...instructions, { role: 'user', text: data.input }];
  }
  return [
    ...instructions,
    ...data.input.map((item) => ({
      role: item.role as CompatRole,
      text: extract_text(item.content),
    })),
  ];
}

function response_body(result: CompatTurnResult, status: 'in_progress' | 'completed') {
  return {
    id: result.response_id,
    object: 'response',
    created_at: unix_seconds(),
    model: compat_model_id,
    status,
    output:
      status === 'completed'
        ? [
            {
              type: 'message',
              id: message_item_id(result),
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text: result.text, annotations: [] }],
            },
          ]
        : [],
    output_text: status === 'completed' ? result.text : '',
    usage: {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      total_tokens: result.usage.input_tokens + result.usage.output_tokens,
    },
  };
}

function response_stream_frames(result: CompatTurnResult): string[] {
  const item_id = message_item_id(result);
  return [
    frame('response.created', {
      type: 'response.created',
      response: response_body(result, 'in_progress'),
    }),
    frame('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id,
      output_index: 0,
      content_index: 0,
      delta: result.text,
    }),
    frame('response.output_text.done', {
      type: 'response.output_text.done',
      item_id,
      output_index: 0,
      content_index: 0,
      text: result.text,
    }),
    frame('response.completed', {
      type: 'response.completed',
      response: response_body(result, 'completed'),
    }),
  ];
}

function frame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function message_item_id(result: CompatTurnResult): string {
  return `msg_${result.session_id}`;
}
