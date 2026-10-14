import { choices_answer_schema } from '@coworker/core/access/choices_wait_schema';
import type { Database } from '@coworker/core/db/connection';
import { events } from '@coworker/core/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export const choices_answer_event_type = 'person.answered_choices';

export const choices_answer_wake_channel = 'person_answered_choices';

export type ChoicesAnswer = {
  answer_text: string;
  answered_by: string;
  answer_event_id: string;
};

export async function find_choices_answer(
  db: Database,
  input: { workspace_id: string; job_id: string; queue_key: string },
): Promise<ChoicesAnswer | null> {
  const answered = await db.query.events.findFirst({
    where: and(
      eq(events.workspace_id, input.workspace_id),
      eq(events.event_type, choices_answer_event_type),
      eq(events.queue_key, input.queue_key),
    ),
    orderBy: [desc(events.created_time)],
  });
  if (!answered) return null;

  const body = choices_answer_schema.safeParse(answered.event_body);
  if (!body.success || body.data.job_id !== input.job_id) return null;

  return {
    answer_text: body.data.answer_text,
    answered_by: answered.actor_key,
    answer_event_id: answered.event_id,
  };
}
