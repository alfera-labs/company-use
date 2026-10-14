import { create_llm_gateway } from '@agent-core/llm_gateway';
import { create_logger, format_error_message } from '@coworker/shared';
import { format_event_for_judge } from '@runtime-platform/triggers/trigger_judge';
import { z } from 'zod';

const log = create_logger('triage_signal_verdict');

const reply_envelope_schema = z.record(z.string(), z.unknown());

const triage_urgencies = ['deadline', 'expires_soon', 'routine'] as const;

export type TriageVerdict = {
  important_now: number;
  importance_reason: string;
  urgency: (typeof triage_urgencies)[number];
  could_automate: boolean;
  automation_sentence: string | null;
  subject: string;
  claim: string;
};

const triage_instructions = `You triage ONE signal for a person's assistant. No automation is watching this signal, so if it matters, you are the only reason the person hears about it today.
Answer only from the signal below. Never invent senders, amounts, dates or intent it does not show.
Keys:
- important_now: 0 to 1 — how much this deserves their attention TODAY. Routine noise is below 0.3; a deadline, money, or a person waiting on an answer is above 0.8.
- importance_reason: one short sentence quoting what in the signal decided it. 300 characters at most.
- urgency: "deadline" (a date decides it), "perishable" (it stops being useful soon) or "routine".
- could_automate: true when a person would plausibly want this handled the same way every time.
- automation_sentence: the one-line instruction that person would say, e.g. "when an invoice arrives, file it and tell me before it is due". null when could_automate is false, or when an automation listed below already covers it.
- subject: what the signal is about, 8 words at most (a thread, an invoice, a flight).
- claim: what is true about that subject, 12 words at most.
Reply with only this JSON object, no other keys: {"important_now": 0.0, "importance_reason": "...", "urgency": "routine", "could_automate": false, "automation_sentence": null, "subject": "...", "claim": "..."}`;

export async function judge_signal_for_triage(input: {
  workspace_id: string;
  guidance: string;
  automation_names: string[];
  data: Record<string, unknown>;
}): Promise<TriageVerdict | null> {
  try {
    const result = await create_llm_gateway().generate_object({
      use_case: 'classification',
      workspace_id: input.workspace_id,
      system_prompt: triage_instructions,
      messages: [{ role: 'user', content: [{ type: 'text', text: triage_question(input) }] }],
      response_format: { type: 'json_object', schema_name: 'triage_signal_verdict' },
      parse: (value) => reply_envelope_schema.parse(value),
    });
    return read_triage_verdict(result.object);
  } catch (error) {
    log.warn('a signal could not be triaged', {
      workspace_id: input.workspace_id,
      error: format_error_message(error),
    });
    return null;
  }
}

function triage_question(input: {
  guidance: string;
  automation_names: string[];
  data: Record<string, unknown>;
}) {
  const automations =
    input.automation_names.length > 0 ? input.automation_names.join('; ') : '(none yet)';
  const guidance = input.guidance.trim() ? input.guidance.trim() : '(nothing written yet)';
  return [
    `What this person says matters:\n${guidance}`,
    `Automations they already have:\n${automations}`,
    `Signal:\n${format_event_for_judge(input.data)}`,
  ].join('\n\n');
}

const lenient_text = z.preprocess(
  (value) => (typeof value === 'number' || typeof value === 'boolean' ? String(value) : value),
  z.string().catch(''),
);

const lenient_score = z
  .preprocess(
    (value) =>
      typeof value === 'string' ? Number.parseFloat(value.trim().replace('%', '')) : value,
    z.number().nullable().catch(null),
  )
  .transform((number) =>
    number === null ? null : Math.min(Math.max(number > 1 ? number / 100 : number, 0), 1),
  );

const lenient_yes_no = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text === 'true' || text === 'yes') return true;
  if (text === 'false' || text === 'no') return false;
  return null;
}, z.boolean().nullable().catch(null));

const triage_reply_schema = z.object({
  important_now: lenient_score,
  importance_reason: lenient_text,
  urgency: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(triage_urgencies).catch('routine'),
  ),
  could_automate: lenient_yes_no,
  automation_sentence: lenient_text,
  subject: lenient_text,
  claim: lenient_text,
});

function read_triage_verdict(raw: Record<string, unknown>): TriageVerdict | null {
  const reply = triage_reply_schema.parse(raw);
  if (reply.important_now === null) return null;
  const sentence = reply.automation_sentence.trim().slice(0, 200);
  const could_automate = reply.could_automate ?? Boolean(sentence);
  return {
    important_now: reply.important_now,
    importance_reason: reply.importance_reason.trim().slice(0, 300) || 'no reason given',
    urgency: reply.urgency,
    could_automate,
    automation_sentence: could_automate && sentence ? sentence : null,
    subject: reply.subject.trim().slice(0, 200) || 'an unnamed signal',
    claim: reply.claim.trim().slice(0, 200) || 'arrived',
  };
}
