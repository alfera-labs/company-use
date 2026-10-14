import { z } from 'zod';

export const present_choices_node_key = 'chat-present_choices-1';

const choice_question_schema = z
  .strictObject({
    kind: z
      .enum(['choice', 'text'])
      .default('choice')
      .describe(
        'choice for a question answered by picking one of your options. text for a question whose answer is naturally typed - a city, a name, an amount.',
      ),
    question: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('The decision, as one plain question. No preamble.'),
    options: z
      .array(
        z.strictObject({
          label: z
            .string()
            .trim()
            .min(1)
            .max(60)
            .describe('What the row says, and the exact words sent back as the answer.'),
          description: z
            .string()
            .trim()
            .max(200)
            .optional()
            .describe('One line on what this option means. Omit when the label already says it.'),
        }),
      )
      .min(2)
      .max(4)
      .optional()
      .describe('Two to four options, the recommended one first. Required on a choice question.'),
    recommended_option: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('The label of the option you recommend. Must match one of the option labels.'),
    placeholder: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe('The greyed hint inside a text question\'s box, such as "Milan".'),
    stakes: z.string().trim().max(200).optional().describe('One line on what this choice affects.'),
  })
  .superRefine((value, ctx) => {
    const reject = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] });

    if (value.kind === 'text') {
      if (value.options) reject('A text question is typed, so it carries no options.', 'options');
      if (value.recommended_option) {
        reject('A text question has nothing to recommend.', 'recommended_option');
      }
      return;
    }
    if (!value.options) return reject('A choice question needs its options.', 'options');
    if (!value.recommended_option) {
      return reject('A choice question needs a recommended option.', 'recommended_option');
    }
    if (value.options.some((option) => option.label === value.recommended_option)) return;
    reject('recommended_option must be exactly one of the option labels.', 'recommended_option');
  });

export const present_choices_input_schema = z.strictObject({
  questions: z
    .array(choice_question_schema)
    .min(1)
    .max(3)
    .describe(
      'One to three questions, asked as one short interview. The panel pages through them and sends every answer back in one reply.',
    ),
});

export type PresentChoices = z.infer<typeof present_choices_input_schema>;
export type PresentChoicesQuestion = PresentChoices['questions'][number];

export function read_present_choices(tool_input: unknown): PresentChoices | null {
  const parsed = present_choices_input_schema.safeParse(tool_input);
  return parsed.success ? parsed.data : null;
}

const present_choices_result_schema = z.looseObject({
  answered: z.boolean(),
  answer: z.string().optional(),
});

const present_choices_output_schema = z.union([
  z.looseObject({ data: present_choices_result_schema }).transform((output) => output.data),
  present_choices_result_schema,
]);

export function read_present_choices_answer(tool_output: unknown): string | null {
  const parsed = present_choices_output_schema.safeParse(tool_output);
  if (!parsed.success || !parsed.data.answered) return null;
  return parsed.data.answer?.trim() || null;
}
