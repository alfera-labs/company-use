import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import {
  assert_choices_answerer,
  may_answer_the_choices,
} from '@api/services/policies/policy_authority';
import { require_chat_person_reads } from '@api/services/team/team_private_chats';
import { read_choices_wait } from '@coworker/core/access/choices_wait_schema';
import {
  get_tool_policy_wait,
  list_tool_policy_waits,
} from '@coworker/core/db/queries/event_waits';
import { record_the_choices_answer } from '@coworker/runtime-platform';
import { NotFoundError, ValidationError } from '@coworker/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const open_query_schema = z.object({ session_id: z.string().trim().min(1) }).strict();

const answer_schema = z.object({ answer_text: z.string().trim().min(1).max(4_000) }).strict();

export type OpenChoicesWait = {
  job_id: string;
  session_id: string;
  tool_call_id?: string;
};

export const choices_routes = new Hono<ApiEnv>()
  .get('/v1/choices/open', validate_query(open_query_schema), async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const user_id = c.get('user_id');
    const { session_id } = c.req.valid('query');
    await require_chat_person_reads(db, { workspace_id, user_id }, session_id);

    const waits = await list_tool_policy_waits(db, { workspace_id, status: 'waiting' });
    for (const wait of waits) {
      const parked = read_choices_wait(wait.metadata);
      if (!parked || parked.session_id !== session_id) continue;
      const may_answer = await may_answer_the_choices(db, {
        workspace_id,
        user_id,
        eligible_user_ids: parked.eligible_user_ids,
      });
      if (!may_answer) continue;
      return c.json(
        ok<OpenChoicesWait | null>({
          job_id: wait.job_id,
          session_id,
          ...(parked.tool_call_id ? { tool_call_id: parked.tool_call_id } : {}),
        }),
      );
    }
    return c.json(ok<OpenChoicesWait | null>(null));
  })
  .post('/v1/choices/:job_id/answer', validate_json(answer_schema), async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const wait = await get_tool_policy_wait(db, { workspace_id, job_id: c.req.param('job_id') });
    if (!wait) throw new NotFoundError('Question');

    const parked = read_choices_wait(wait.metadata);
    if (!parked) throw new NotFoundError('Question');
    await require_chat_person_reads(
      db,
      { workspace_id, user_id: c.get('user_id') },
      parked.session_id,
    );
    if (wait.job_status !== 'waiting') {
      throw new ValidationError('This question has already been answered.');
    }
    await assert_choices_answerer(db, {
      workspace_id,
      user_id: c.get('user_id'),
      eligible_user_ids: parked.eligible_user_ids,
    });

    const answered = await record_the_choices_answer(db, {
      workspace_id,
      job_id: wait.job_id,
      queue_key: wait.awaits_queue_key ?? wait.queue_key,
      answered_by: c.get('user_id'),
      answer_text: c.req.valid('json').answer_text,
    });
    if (!answered) throw new ValidationError('This question has already been answered.');
    return c.json(ok({ answered: true }));
  });
