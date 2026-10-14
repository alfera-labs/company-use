import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { always_allow_tool_subject } from '@api/services/policies/always_allow_tool_subject';
import {
  assert_policy_decider,
  is_policy_workspace_administrator,
} from '@api/services/policies/policy_authority';
import { remember_the_approval } from '@api/services/policies/remember_the_approval';
import {
  read_calls_a_person_is_asked_about,
  tool_policy_approval_wait_schema,
} from '@coworker/core/access/tool_policy_approval_schema';
import {
  get_tool_policy_wait,
  list_tool_policy_waits,
} from '@coworker/core/db/queries/event_waits';
import { record_the_answer } from '@coworker/runtime-platform';
import { NotFoundError, ValidationError } from '@coworker/shared';
import {
  read_tool_approval_view,
  read_tool_approval_views,
} from '@runtime-platform/tools/policies/approval_reader_service';
import { Hono } from 'hono';
import { z } from 'zod';

const list_waits_schema = z
  .object({
    status: z.enum(['waiting', 'queued', 'running', 'done']).optional(),
  })
  .strict();

const decision_schema = z
  .object({
    decision: z.enum(['approved', 'denied']),
    reason: z.string().trim().min(1).max(2_000).optional(),
    always_allow_subject: z.string().trim().min(1).max(400).optional(),
    always_allow_tools: z.boolean().optional(),
    always_allow_scope: z.enum(['perpetual', 'time_bounded', 'automation', 'batch']).optional(),
  })
  .strict();

export const approval_routes = new Hono<ApiEnv>()
  .get('/v1/approvals', validate_query(list_waits_schema), async (c) => {
    const query = c.req.valid('query');
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const user_id = c.get('user_id');
    const [waits, can_view_all] = await Promise.all([
      list_tool_policy_waits(db, {
        workspace_id,
        ...(query.status ? { status: query.status } : {}),
      }),
      is_policy_workspace_administrator(db, { workspace_id, user_id }),
    ]);
    const visible_waits = can_view_all
      ? waits
      : waits.filter((wait) => can_user_decide(wait.metadata.policy_approval, user_id));
    return c.json(ok(await read_tool_approval_views(db, { workspace_id, waits: visible_waits })));
  })
  .get('/v1/approvals/:job_id', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const wait = await require_wait(db, workspace_id, c.req.param('job_id'));
    const approval = tool_policy_approval_wait_schema.parse(wait.metadata.policy_approval);
    await assert_policy_decider(db, {
      workspace_id,
      user_id: c.get('user_id'),
      eligible_user_ids: approval.eligible_user_ids,
    });
    const view = await read_tool_approval_view(db, workspace_id, wait);
    if (!view) throw new NotFoundError('Approval');
    return c.json(ok(view));
  })
  .post('/v1/approvals/:job_id/decision', validate_json(decision_schema), async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const wait = await require_wait(db, workspace_id, c.req.param('job_id'));
    if (wait.job_status !== 'waiting') {
      throw new ValidationError(`This approval is already ${wait.job_status}.`);
    }
    const approval = tool_policy_approval_wait_schema.parse(wait.metadata.policy_approval);
    await assert_policy_decider(db, {
      workspace_id,
      user_id: c.get('user_id'),
      eligible_user_ids: approval.eligible_user_ids,
    });
    const body = c.req.valid('json');
    const asked_tool_call_ids = read_calls_a_person_is_asked_about(approval).map(
      (call) => call.tool_call_id,
    );
    const remembered =
      body.decision === 'approved' && body.always_allow_subject
        ? await always_allow_tool_subject(db, {
            workspace_id,
            user_id: c.get('user_id'),
            session_id: approval.session_id,
            tool_call_ids: asked_tool_call_ids,
            subject_policy_id: body.always_allow_subject,
          })
        : body.decision === 'approved' && body.always_allow_tools
          ? await remember_the_approval(db, {
              workspace_id,
              user_id: c.get('user_id'),
              session_id: approval.session_id,
              tool_call_ids: asked_tool_call_ids,
              kind: body.always_allow_scope ?? 'perpetual',
              view: await read_tool_approval_view(db, workspace_id, wait),
            })
          : null;
    const answered = await record_the_answer(db, {
      workspace_id,
      job_id: wait.job_id,
      queue_key: wait.awaits_queue_key ?? wait.queue_key,
      decided_by: c.get('user_id'),
      decision: body.decision,
      reason: body.reason,
    });
    if (!answered) throw new ValidationError('This approval was already decided.');
    return c.json(ok({ event: answered.event, approval: answered.approval, remembered }));
  });

async function require_wait(db: ApiEnv['Variables']['db'], workspace_id: string, job_id: string) {
  const wait = await get_tool_policy_wait(db, { workspace_id, job_id });
  if (!wait) throw new NotFoundError('Approval');
  return wait;
}

function can_user_decide(value: unknown, user_id: string) {
  const approval = tool_policy_approval_wait_schema.safeParse(value);
  return approval.success && approval.data.eligible_user_ids.includes(user_id);
}
