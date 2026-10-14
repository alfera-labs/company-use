import { z } from 'zod';

export const choices_wait_schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('choices_wait'),
    session_id: z.string().min(1),
    source_run_id: z.string().min(1),
    asked_by: z.string().min(1).nullable(),
    eligible_user_ids: z.array(z.string().min(1)),
    tool_call_id: z.string().min(1).optional(),
  })
  .strict();

export type ChoicesWait = z.infer<typeof choices_wait_schema>;

export const choices_answer_schema = z
  .object({
    job_id: z.string().min(1),
    answer_text: z.string().min(1).max(4_000),
  })
  .strict();

export function read_choices_wait(metadata: unknown): ChoicesWait | null {
  const wait = (metadata as { choices_wait?: unknown } | null)?.choices_wait;
  if (wait === undefined) return null;
  const parsed = choices_wait_schema.safeParse(wait);
  return parsed.success ? parsed.data : null;
}
