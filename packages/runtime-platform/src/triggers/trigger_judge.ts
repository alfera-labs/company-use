import type { LlmUsage } from '@agent-core/llm_gateway';
import { create_llm_gateway } from '@agent-core/llm_gateway';
import { env } from '@coworker/config';
import { create_logger, format_error_message } from '@coworker/shared';
import { judge_trigger_event_with_jev } from '@runtime-platform/triggers/jev_judge';
import {
  judge_instructions,
  stricter_reminder,
} from '@runtime-platform/triggers/trigger_judge_instructions';
import { z } from 'zod';

const log = create_logger('trigger_judge');

const reply_envelope_schema = z.record(z.string(), z.unknown());

const lenient_text = z.preprocess(
  (value) => (typeof value === 'number' || typeof value === 'boolean' ? String(value) : value),
  z.string().catch(''),
);

const lenient_yes_no = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text === 'yes' || text === 'true') return true;
  if (text === 'no' || text === 'false') return false;
  return null;
}, z.boolean().nullable().catch(null));

const lenient_sureness = z
  .preprocess(
    (value) =>
      typeof value === 'string' ? Number.parseFloat(value.trim().replace('%', '')) : value,
    z.number().nullable().catch(null),
  )
  .transform((number) =>
    number === null ? null : Math.min(Math.max(number > 1 ? number / 100 : number, 0), 1),
  );

const judge_reply_schema = z.object({
  answer: lenient_yes_no,
  yes_no: lenient_yes_no,
  yes: lenient_yes_no,
  yesno: lenient_yes_no,
  yes_no_answer: lenient_yes_no,
  confidence: lenient_sureness,
  kind: lenient_text,
  reason: lenient_text,
});

const answer_keys = ['answer', 'yes_no', 'yes', 'yesno', 'yes_no_answer'] as const;
const assumed_confidence = 0.9;

export type TriggerJudgeVerdict = {
  kind: string;
  answer: 'yes' | 'no' | null;
  confidence: number | null;
  reason: string;
  usage?: LlmUsage;
};

/** Two unreadable replies answer `confidence: null`: the caller then runs, on purpose. */
export async function judge_trigger_event(input: {
  workspace_id: string;
  question: string;
  data: Record<string, unknown>;
}): Promise<TriggerJudgeVerdict> {
  if (env.COWORKER_DOOR_JUDGE === 'jev') {
    try {
      return await judge_trigger_event_with_jev(input);
    } catch (error) {
      log.warn('jev judge failed; falling back to the chat judge', {
        workspace_id: input.workspace_id,
        message: format_error_message(error),
      });
    }
  }
  const first = await ask_the_judge(input, '');
  if (first.verdict) return first.verdict;
  const second = await ask_the_judge(input, stricter_reminder);
  if (second.verdict) return second.verdict;
  return {
    kind: 'unknown',
    answer: null,
    confidence: null,
    reason: `judge unavailable: ${second.error}`.slice(0, 200),
  };
}

async function ask_the_judge(
  input: { workspace_id: string; question: string; data: Record<string, unknown> },
  reminder: string,
): Promise<{ verdict: TriggerJudgeVerdict | null; error: string }> {
  try {
    const result = await create_llm_gateway().generate_object({
      use_case: 'classification',
      workspace_id: input.workspace_id,
      system_prompt: `${judge_instructions}${reminder}`,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Question: ${input.question}\n\nEvent:\n${format_event_for_judge(input.data)}`,
            },
          ],
        },
      ],
      response_format: { type: 'json_object', schema_name: 'trigger_judge_verdict' },
      parse: (value) => reply_envelope_schema.parse(value),
    });
    const verdict = read_verdict(result.object);
    if (!verdict) return { verdict: null, error: `unreadable reply: ${result.text.slice(0, 120)}` };
    return {
      verdict: result.result?.usage ? { ...verdict, usage: result.result.usage } : verdict,
      error: '',
    };
  } catch (error) {
    if (!is_unreadable_reply(error)) throw error;
    return { verdict: null, error: format_error_message(error) };
  }
}

function is_unreadable_reply(error: unknown): boolean {
  if (error instanceof z.ZodError) return true;
  return error instanceof Error && error.message.startsWith('LLM response was not valid JSON');
}

export function read_verdict(raw: Record<string, unknown>): TriggerJudgeVerdict | null {
  const reply = judge_reply_schema.parse(raw);
  const answer = answer_keys.map((key) => reply[key]).find((value) => value !== null) ?? null;
  const sureness = reply.confidence;
  if (answer === null && sureness === null) return null;
  return {
    kind: to_snake_case_word(reply.kind),
    answer: answer === null ? null : answer ? 'yes' : 'no',
    confidence: probability_of_yes(answer, sureness),
    reason: reply.reason.trim().slice(0, 200),
  };
}

function probability_of_yes(answer: boolean | null, sureness: number | null): number {
  if (answer === null) return sureness ?? assumed_confidence;
  const sure = sureness ?? assumed_confidence;
  return answer ? sure : Math.round((1 - sure) * 1000) / 1000;
}

const max_event_characters = 4000;
const max_field_characters = 500;

export function format_event_for_judge(
  data: Record<string, unknown>,
  max_characters = max_event_characters,
): string {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of flatten_one_level(data)) {
    const next = { ...fields, [key]: value };
    if (JSON.stringify(next).length > max_characters) break;
    fields[key] = value;
  }
  return JSON.stringify(fields);
}

function flatten_one_level(data: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(data).flatMap(([key, value]) => {
    const readable = read_readable_value(value);
    if (readable !== undefined) return [[key, readable] as [string, unknown]];
    if (!is_plain_object(value)) return [];
    return Object.entries(value).flatMap(([child_key, child_value]) => {
      const child = read_readable_value(child_value);
      return child === undefined ? [] : [[`${key}.${child_key}`, child] as [string, unknown]];
    });
  });
}

function read_readable_value(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(/\s+/gu, ' ').trim().slice(0, max_field_characters);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (!Array.isArray(value)) return undefined;
  const items = value.map(read_readable_value).filter((item) => item !== undefined);
  return items.length > 0 && items.length === value.length ? items : undefined;
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function to_snake_case_word(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'unknown'
  );
}
