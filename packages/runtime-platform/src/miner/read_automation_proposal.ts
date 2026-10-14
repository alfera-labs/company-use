import { create_llm_gateway } from '@agent-core/llm_gateway';
import { create_logger, format_error_message } from '@coworker/shared';
import type { RecurringAsk } from '@runtime-platform/miner/group_recurring_asks';
import { z } from 'zod';

const log = create_logger('automation_miner');

export type AutomationProposal = {
  automation_sentence: string;
  trigger_kind: 'schedule' | 'app_event';
  cron_or_node_key: string | null;
  confidence: number;
};

const proposal_instructions = `You read three or more requests the SAME person typed to their assistant on different weeks. They keep asking by hand. Write the standing automation that would do it for them.
Answer only from the requests. Never invent apps, people, amounts or times they do not show.
Keys:
- automation_sentence: the one-line instruction the person would say, present tense, e.g. "every Friday, compile the fintech-CEO list and post it to #sales". 200 characters at most.
- trigger_kind: "schedule" when a clock decides it, "app_event" when something arriving decides it.
- cron_or_node_key: a 5-field cron for a schedule (e.g. "0 9 * * FRI"), or the app event that starts it (e.g. "gmail-new_message-1"). null when the requests do not say.
- confidence: 0 to 1 — how sure you are this is one repeated job rather than three unrelated requests that happen to share words.
Reply with only this JSON object, no other keys: {"automation_sentence": "...", "trigger_kind": "schedule", "cron_or_node_key": null, "confidence": 0.0}`;

export async function read_automation_proposal(input: {
  workspace_id: string;
  candidate: RecurringAsk;
}): Promise<AutomationProposal | null> {
  try {
    const result = await create_llm_gateway().generate_object({
      use_case: 'classification',
      workspace_id: input.workspace_id,
      system_prompt: proposal_instructions,
      messages: [
        { role: 'user', content: [{ type: 'text', text: proposal_question(input.candidate) }] },
      ],
      response_format: { type: 'json_object', schema_name: 'automation_proposal' },
      parse: (value) => z.record(z.string(), z.unknown()).parse(value),
    });
    return read_proposal(result.object);
  } catch (error) {
    log.warn('a recurring ask could not be turned into a proposal', {
      workspace_id: input.workspace_id,
      ask_key: input.candidate.ask_key,
      error: format_error_message(error),
    });
    return null;
  }
}

function proposal_question(candidate: RecurringAsk) {
  return [
    `They asked ${candidate.ask_count} times across ${candidate.distinct_weeks} different weeks.`,
    `Requests, in their own words:\n${candidate.example_asks.map((ask) => `- ${ask}`).join('\n')}`,
  ].join('\n\n');
}

const loose_text = z
  .union([z.string(), z.number(), z.boolean()])
  .catch('')
  .transform((value) => String(value));

const confidence = z
  .preprocess(
    (value) =>
      typeof value === 'string' ? Number.parseFloat(value.trim().replace('%', '')) : value,
    z.number().refine(Number.isFinite).catch(0.5),
  )
  .transform((number) => Math.min(Math.max(number > 1 ? number / 100 : number, 0), 1));

const proposal_schema = z.object({
  automation_sentence: loose_text,
  trigger_kind: loose_text,
  cron_or_node_key: loose_text,
  confidence,
});

function read_proposal(raw: Record<string, unknown>): AutomationProposal | null {
  const proposal = proposal_schema.parse(raw);
  const automation_sentence = proposal.automation_sentence.trim().slice(0, 200);
  if (!automation_sentence) return null;
  const hint = proposal.cron_or_node_key.trim().slice(0, 100);
  return {
    automation_sentence,
    trigger_kind:
      proposal.trigger_kind.trim().toLowerCase() === 'app_event' ? 'app_event' : 'schedule',
    cron_or_node_key: hint && hint.toLowerCase() !== 'null' ? hint : null,
    confidence: proposal.confidence,
  };
}
