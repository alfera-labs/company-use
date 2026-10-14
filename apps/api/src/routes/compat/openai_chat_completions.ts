import { randomUUID } from 'node:crypto';
import type { ApiKeyEnv } from '@api/lib/context';
import { parse_json_body } from '@api/lib/validate';
import { compat_model_id } from '@api/routes/compat/compat_models';
import { type CompatTurnResult, run_compat_turn } from '@api/routes/compat/compat_turn';
import {
  type CompatRole,
  conversation_to_text_blocks,
  extract_text,
  sse_headers,
  sse_stream,
  unix_seconds,
} from '@api/routes/compat/compat_wire';
import type { Context } from 'hono';
import { z } from 'zod';

// OpenAI Chat Completions over the session machinery. The `messages` array becomes one session
// turn; the agent's final text comes back as the assistant message. `stream:true` returns
// `chat.completion.chunk` SSE frames.
//
// Honored: `messages` (roles folded into the turn), `stream`. Accepted and ignored (documented, not
// silently claimed): `model` — the logical model is always `alfera`; `temperature`, `top_p`,
// `max_tokens`, `n`, `stop`, `seed` — the agent governs its own generation; `tools`, `tool_choice`,
// `functions` — the agent runs its workspace-configured tool surface, not the caller's; and
// `response_format` — the session machinery has no per-turn response-format hook, so a
// json_schema request is not enforced. Unknown fields pass through untouched.

const message_schema = z
  .object({
    role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.array(z.unknown())]).nullish(),
    name: z.string().optional(),
  })
  .loose();

const body_schema = z
  .object({
    messages: z.array(message_schema).min(1),
    stream: z.boolean().optional(),
  })
  .loose();

export async function openai_chat_completions(c: Context<ApiKeyEnv>): Promise<Response> {
  const body = await parse_json_body(c, body_schema);
  const turns = body.messages.map((message) => ({
    role: message.role as CompatRole,
    text: extract_text(message.content),
  }));
  const result = await run_compat_turn(c.get('db'), {
    api_key: c.get('api_key'),
    content: conversation_to_text_blocks(turns),
    idempotency_key: c.req.header('idempotency-key')?.trim() || undefined,
    signal: c.req.raw.signal,
  });

  if (body.stream) {
    return c.body(sse_stream(chunk_frames(result)), 200, sse_headers);
  }
  return c.json(completion_body(result));
}

function completion_body(result: CompatTurnResult) {
  return {
    id: completion_id(),
    object: 'chat.completion',
    created: unix_seconds(),
    model: compat_model_id,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.text },
        finish_reason: 'stop',
      },
    ],
    usage: usage_body(result),
  };
}

function chunk_frames(result: CompatTurnResult): string[] {
  const id = completion_id();
  const created = unix_seconds();
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null) =>
    frame({
      id,
      object: 'chat.completion.chunk',
      created,
      model: compat_model_id,
      choices: [{ index: 0, delta, finish_reason }],
    });
  return [
    chunk({ role: 'assistant' }, null),
    chunk({ content: result.text }, null),
    chunk({}, 'stop'),
    'data: [DONE]\n\n',
  ];
}

function usage_body(result: CompatTurnResult) {
  return {
    prompt_tokens: result.usage.input_tokens,
    completion_tokens: result.usage.output_tokens,
    total_tokens: result.usage.input_tokens + result.usage.output_tokens,
  };
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function completion_id(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, '')}`;
}
