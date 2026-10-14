import { run_messages } from '@coworker/core/db/schema';
import type { ConnectionResumeIntentData } from '@coworker/core/db/schema/json_column_types';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { and, desc, eq } from 'drizzle-orm';

export const max_resume_instruction_length = 500;

export type ConnectionResumeSetup = {
  setup_session_id?: string | undefined;
  resume?: ConnectionResumeIntentData | undefined;
};

type ResumeMessage = Pick<typeof run_messages.$inferSelect, 'content_text' | 'message_content'>;

export async function build_connection_resume_intent(input: {
  context: RuntimeToolExecutionContext;
  instruction?: string | undefined;
}): Promise<ConnectionResumeIntentData | undefined> {
  const instruction =
    clean_resume_instruction(input.instruction) ??
    (await latest_user_message_instruction(input.context));
  if (!instruction) return undefined;

  return {
    session_id: input.context.session_id,
    batch_id: input.context.run_id,
    actor_id: input.context.speaker?.source_actor_id ?? input.context.actor_id,
    instruction,
    created_at: new Date().toISOString(),
  };
}

async function latest_user_message_instruction(context: RuntimeToolExecutionContext) {
  const [message] = await context.db
    .select({
      content_text: run_messages.content_text,
      message_content: run_messages.message_content,
    })
    .from(run_messages)
    .where(
      and(
        eq(run_messages.workspace_id, context.workspace_id),
        eq(run_messages.session_id, context.session_id),
        eq(run_messages.message_role, 'user'),
        eq(run_messages.is_user_visible, true),
      ),
    )
    .orderBy(desc(run_messages.message_sequence))
    .limit(1);

  const text = read_message_text(message);
  return text ? truncate_resume_instruction(text) : undefined;
}

function read_message_text(message?: ResumeMessage) {
  return (
    clean_resume_instruction(message?.content_text) ??
    clean_resume_instruction(message?.message_content.text)
  );
}

function clean_resume_instruction(value: string | null | undefined) {
  if (!value) return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 0 ? text : undefined;
}

function truncate_resume_instruction(text: string) {
  if (text.length <= max_resume_instruction_length) return text;
  return `${text.slice(0, max_resume_instruction_length - 3).trimEnd()}...`;
}
