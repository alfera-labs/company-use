import { randomUUID } from 'node:crypto';
import type { ApiEnv, ApiKeyEnv } from '@api/lib/context';
import { parse_json_body } from '@api/lib/validate';
import { compat_model_id } from '@api/routes/compat/compat_models';
import { type CompatTurnResult, run_compat_turn } from '@api/routes/compat/compat_turn';
import {
  type CompatTurn,
  conversation_to_text_blocks,
  extract_text,
  sse_headers,
  sse_stream,
} from '@api/routes/compat/compat_wire';
import { estimate_context_tokens_roughly } from '@coworker/shared';
import type { Context } from 'hono';
import { z } from 'zod';

// Anthropic Messages over the same session machinery. An SDK pointed at the compat base appends
// `/v1/messages`; `max_tokens` is required by the Anthropic contract, so it is required here too.
//
// Honored: `messages` (user/assistant history folded into the turn), `system`, `stream`. Accepted
// and ignored: `model` (always `alfera`), `max_tokens` (required by the contract but the agent
// governs its own generation length), `temperature`/`top_p`/`top_k`/`stop_sequences`, `tools`/
// `tool_choice` (the agent runs its own tool surface). Unknown fields pass through.

const message_schema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.union([z.string(), z.array(z.unknown())]),
  })
  .loose();

const system_schema = z.union([z.string(), z.array(z.unknown())]).optional();

const body_schema = z
  .object({
    messages: z.array(message_schema).min(1),
    max_tokens: z.number().int().positive(),
    system: system_schema,
    stream: z.boolean().optional(),
  })
  .loose();

const count_tokens_body_schema = z
  .object({
    messages: z.array(message_schema).min(1),
    system: system_schema,
  })
  .loose();

export async function anthropic_messages(c: Context<ApiKeyEnv>): Promise<Response> {
  const body = await parse_json_body(c, body_schema);
  const result = await run_compat_turn(c.get('db'), {
    api_key: c.get('api_key'),
    content: conversation_to_text_blocks(request_turns(body.system, body.messages)),
    idempotency_key: c.req.header('idempotency-key')?.trim() || undefined,
    signal: c.req.raw.signal,
  });

  if (body.stream) {
    return c.body(sse_stream(message_stream_frames(result)), 200, sse_headers);
  }
  return c.json(message_body(result));
}

export async function anthropic_count_tokens(c: Context<ApiEnv>): Promise<Response> {
  const body = await parse_json_body(c, count_tokens_body_schema);
  const text = request_turns(body.system, body.messages)
    .map((turn) => turn.text)
    .join('\n');
  return c.json({ input_tokens: Math.max(estimate_context_tokens_roughly(text), 1) });
}

function request_turns(
  system: unknown,
  messages: { role: 'user' | 'assistant'; content: unknown }[],
): CompatTurn[] {
  const system_text = system === undefined ? '' : extract_text(system);
  const system_turn: CompatTurn[] = system_text ? [{ role: 'system', text: system_text }] : [];
  return [
    ...system_turn,
    ...messages.map((message) => ({ role: message.role, text: extract_text(message.content) })),
  ];
}

function message_body(result: CompatTurnResult) {
  return {
    id: message_id(),
    type: 'message',
    role: 'assistant',
    model: compat_model_id,
    content: [{ type: 'text', text: result.text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
  };
}

function message_stream_frames(result: CompatTurnResult): string[] {
  const id = message_id();
  return [
    frame('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: compat_model_id,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: result.usage.input_tokens, output_tokens: 0 },
      },
    }),
    frame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: result.text },
    }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: result.usage.output_tokens },
    }),
    frame('message_stop', { type: 'message_stop' }),
  ];
}

function frame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function message_id(): string {
  return `msg_${randomUUID().replace(/-/g, '')}`;
}
