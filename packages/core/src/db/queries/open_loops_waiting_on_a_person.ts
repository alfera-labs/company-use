import { read_choices_wait } from '@coworker/core/access/choices_wait_schema';
import type { Database } from '@coworker/core/db/connection';
import { choices_answer_event_type } from '@coworker/core/db/queries/choices_answers';
import { list_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import type { OpenLoop } from '@coworker/core/db/queries/open_loops';
import { sessions } from '@coworker/core/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

type Wait = Awaited<ReturnType<typeof list_tool_policy_waits>>[number];
type AskedQuestion = { wait: Wait; session_id: string; source_run_id: string };

/** Lists the held tool calls and the unanswered chat questions that wait on a person. */
export async function list_open_loops_waiting_on_a_person(
  db: Database,
  input: { workspace_id: string; limit: number },
): Promise<OpenLoop[]> {
  const waits = await list_tool_policy_waits(db, {
    workspace_id: input.workspace_id,
    status: 'waiting',
    limit: input.limit,
  });
  const questions = waits.flatMap(read_asked_question);
  const approvals = waits.filter((wait) => wait.awaits_event_type !== choices_answer_event_type);
  const chat_titles = await read_chat_titles(db, input.workspace_id, questions);
  return [
    ...approvals.map(describe_held_tool_call),
    ...questions.map((question) => describe_asked_question(question, chat_titles)),
  ];
}

function read_asked_question(wait: Wait): AskedQuestion[] {
  if (wait.awaits_event_type !== choices_answer_event_type) return [];
  const asked = read_choices_wait(wait.metadata);
  return asked ? [{ wait, session_id: asked.session_id, source_run_id: asked.source_run_id }] : [];
}

function describe_held_tool_call(wait: Wait): OpenLoop {
  return {
    kind: 'approval_waiting',
    reference_id: wait.job_id,
    title: 'A tool call is waiting for a person to approve it',
    detail: `Held since ${wait.created_time.toISOString()}.`,
    since_time: wait.created_time,
  };
}

function describe_asked_question(
  question: AskedQuestion,
  chat_titles: ReadonlyMap<string, string | null>,
): OpenLoop {
  const title = chat_titles.get(question.session_id);
  const chat = title ? `the chat "${title}" (${question.session_id})` : question.session_id;
  return {
    kind: 'question_unanswered',
    reference_id: question.session_id,
    title: 'A question in chat is waiting for the person to pick an answer',
    detail: [
      `The agent asked a multiple-choice question in ${chat} (run ${question.source_run_id}) and nobody has answered it yet.`,
      'The person answers it in that chat. Only that chat waits for the answer; no other work is held.',
      'It is a question, not a tool approval: there is no held call to approve.',
    ].join(' '),
    since_time: question.wait.created_time,
  };
}

async function read_chat_titles(
  db: Database,
  workspace_id: string,
  questions: readonly AskedQuestion[],
): Promise<Map<string, string | null>> {
  if (questions.length === 0) return new Map();
  const rows = await db
    .select({ session_id: sessions.session_id, session_title: sessions.session_title })
    .from(sessions)
    .where(
      and(
        eq(sessions.workspace_id, workspace_id),
        inArray(
          sessions.session_id,
          questions.map((question) => question.session_id),
        ),
      ),
    );
  return new Map(rows.map((row) => [row.session_id, row.session_title]));
}
