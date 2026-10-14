import { read_policy_scope_ids } from '@coworker/core/access/policy_scope_context';
import {
  choices_answer_wake_channel,
  find_choices_answer,
} from '@coworker/core/db/queries/choices_answers';
import {
  choices_wait_subject,
  create_choices_wait,
  record_choices_answer_taken_by_the_run,
} from '@coworker/core/db/queries/event_waits';
import {
  type JsonSchema,
  present_choices_input_schema,
  present_choices_node_key,
} from '@coworker/shared';
import {
  approval_wait_window_ms,
  wait_for_the_person,
} from '@runtime-platform/tools/policies/wait_for_the_person';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const wrapper_grace_ms = 10_000;

const output_schema = z.strictObject({
  answered: z.boolean().optional(),
  answer: z.string().optional(),
  note: z.string().optional(),
  questions: z.array(
    z.strictObject({
      kind: z.enum(['choice', 'text']),
      question: z.string(),
      options: z
        .array(z.strictObject({ label: z.string(), description: z.string().optional() }))
        .optional(),
      recommended_option: z.string().optional(),
      placeholder: z.string().optional(),
      stakes: z.string().optional(),
    }),
  ),
});

export const present_choices_tool: RuntimeToolDefinition<typeof present_choices_input_schema> = {
  node_key: present_choices_node_key,
  node_name: 'present_choices',
  display_name: 'Present choices',
  description:
    'Asks the user to decide, shown as a panel above the composer, and waits for their answer before you continue. Use it when the work is done but a call is genuinely theirs to make. The input is always { "questions": [ ... ] } - a single question is still a one-element array, never top-level question/options fields. One call may carry a short interview: up to 3 questions, each with two to four options and a genuinely sensible recommended default, and the panel pages through them and hands you every answer as this call\'s result. Write labels that read as an answer. Use kind "text" when the answer is naturally typed - a city, a name, an amount - never options that just ask them to share something. At most one call per turn, and never restate the questions in prose afterwards - the panel already asks them.',
  category: 'actions',
  input_schema: z.toJSONSchema(present_choices_input_schema, {
    target: 'draft-7',
    io: 'input',
  }) as JsonSchema,
  output_schema: z.toJSONSchema(output_schema, { target: 'draft-7', io: 'output' }) as JsonSchema,
  app_name: 'chat',
  required_connection: false,
  runtime_handler: 'chat.present_choices',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  available_on_source_types: ['dashboard', 'runtime', 'api', 'tool'],
  waits_for_a_person: true,
  policy_timeout_ms: () => approval_wait_window_ms() + wrapper_grace_ms,
  validate_input: present_choices_input_schema,
  async execute(input, context) {
    const questions = output_schema.parse(input);
    if (!context) return { success: true, data: { ...questions, answered: false } };

    const { db, workspace_id, session_id, run_id, actor_id } = context;
    const queue_key = choices_wait_subject({ run_id });
    const scopes = await read_policy_scope_ids(db, {
      workspace_id,
      session_id,
      ...(context.agent_id ? { agent_id: context.agent_id } : {}),
      actor_id,
      ...(context.speaker ? { acting_actor_id: context.speaker.source_actor_id } : {}),
    });

    const { event_job } = await create_choices_wait(db, {
      workspace_id,
      queue_key,
      actor_id,
      wait: {
        version: 1,
        kind: 'choices_wait',
        session_id,
        source_run_id: run_id,
        asked_by: actor_id,
        eligible_user_ids: [...scopes.user],
        ...(context.tool_call_id ? { tool_call_id: context.tool_call_id } : {}),
      },
    });

    const waited = await wait_for_the_person(db, {
      workspace_id,
      job_id: event_job.job_id,
      queue_key,
      actor_id,
      read_answer: find_choices_answer,
      wake_channel: choices_answer_wake_channel,
      ...(context.signal ? { signal: context.signal } : {}),
    });

    if (!waited.answered) {
      return {
        success: true,
        data: {
          ...questions,
          answered: false,
          note:
            waited.reason === 'the_run_was_cancelled'
              ? 'The run was stopped before anyone answered.'
              : 'Nobody answered in time. Carry on with the recommended defaults and say plainly ' +
                'which ones you assumed, so they can correct it.',
        },
      };
    }

    await record_choices_answer_taken_by_the_run(db, {
      workspace_id,
      job_id: event_job.job_id,
      actor_id,
    });

    return {
      success: true,
      data: { ...questions, answered: true, answer: waited.answer.answer_text },
    };
  },
};
