import {
  max_text_blocks_per_turn,
  turn_text_blocks_schema,
} from '@api/routes/public_session_events';
import type { PublicTextBlock } from '@api/services/sessions_api/session_service';
import { ValidationError } from '@coworker/shared';

export type CompatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export type CompatTurn = { role: CompatRole; text: string };

export function extract_text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .filter((text) => text.length > 0)
    .join('\n');
}

const role_labels: Record<CompatRole, string> = {
  system: 'System',
  developer: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool',
};

export function conversation_to_text_blocks(turns: CompatTurn[]): PublicTextBlock[] {
  const spoken = turns.filter((turn) => turn.text.trim().length > 0);
  if (spoken.length === 0) {
    throw new ValidationError('The request carried no text to send to the agent');
  }
  const first = spoken[0];
  const blocks: PublicTextBlock[] =
    spoken.length === 1 && first && first.role === 'user'
      ? [{ type: 'text', text: first.text }]
      : spoken.map((turn) => ({ type: 'text', text: `${role_labels[turn.role]}: ${turn.text}` }));
  return assert_turn_fits(blocks);
}

function assert_turn_fits(blocks: PublicTextBlock[]): PublicTextBlock[] {
  const checked = turn_text_blocks_schema.safeParse(blocks);
  if (checked.success) return checked.data;
  throw new ValidationError(
    `The conversation is too large for one turn: each message may carry at most 8000 characters, and one turn at most ${max_text_blocks_per_turn} messages.`,
    { issues: checked.error.issues },
  );
}

export function unix_seconds(): number {
  return Math.floor(Date.now() / 1000);
}

const encoder = new TextEncoder();

export function sse_stream(frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

export const sse_headers = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
