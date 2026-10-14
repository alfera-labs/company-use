import { read_present_choices_answer } from '@coworker/shared';
import { z } from 'zod';

const result_from_the_live_stream_schema = z.looseObject({
  content: z.array(z.looseObject({ text: z.string().optional() })).optional(),
  content_json: z.unknown().optional(),
});

const result_that_nobody_answered_schema = z.union([
  z.looseObject({ data: z.looseObject({ answered: z.literal(false) }) }),
  z.looseObject({ answered: z.literal(false) }),
]);

function parse_json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function results_inside(output: unknown): unknown[] {
  if (typeof output === 'string') return [parse_json(output)];
  const from_the_live_stream = result_from_the_live_stream_schema.safeParse(output);
  if (!from_the_live_stream.success) return [output];
  const { content = [], content_json } = from_the_live_stream.data;
  return [output, content_json, ...content.map((block) => parse_json(block.text ?? ''))];
}

/**
 * The answer a person gave to a question, read from the output of the question tool. The stored
 * tool call holds the result itself. The live stream holds the result the engine handed to the
 * model: the same result as JSON text inside content blocks.
 */
export function read_choice_answer(output: unknown) {
  for (const result of results_inside(output)) {
    const answer = read_present_choices_answer(result);
    if (answer) return answer;
  }
  return null;
}

function says_nobody_answered(output: unknown) {
  return results_inside(output).some(
    (result) => result_that_nobody_answered_schema.safeParse(result).success,
  );
}

/**
 * The quiet words after "Asked you to choose". A question says "nobody answered" only when its
 * output says so, or when it ended without one. A question the person just answered is marked
 * completed a moment before its answer can be read; in that moment nothing is said.
 */
export function choice_trace_words(
  question: { state: string; output?: unknown },
  settled_states: ReadonlySet<string>,
) {
  if (!settled_states.has(question.state)) return '· waiting for your answer';
  const answer_is_on_its_way =
    question.state === 'completed' && !says_nobody_answered(question.output);
  return answer_is_on_its_way ? '' : '· nobody answered';
}
