import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  create_tool_policy_wait,
  hash_tool_input_for_approval,
  policy_decision_event_type,
  tool_policy_wait_subject,
} from '@coworker/core/db/queries/event_waits';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { set_policy } from '@coworker/core/db/queries/policies';
import { create_session } from '@coworker/core/db/queries/sessions';
import { claim_ready_event_jobs_for_queue } from '@coworker/jobs';
import { math_calculate_tool } from '@runtime-platform/tools/definitions/math_calculate';
import { find_tool_policy_error } from '@runtime-platform/tools/policies/tool_policy_gate';
import { beforeEach, describe, expect, it } from 'vitest';

let fixture: Awaited<ReturnType<typeof create_fixture>>;
const approval_tool_call_id = 'tcall_held_1';

beforeEach(async () => {
  fixture = await create_fixture();
});

describe('the gate at the moment of execution', () => {
  it('blocks never before provider dispatch', async () => {
    await write_mode('never');
    expect(await check_policy(fixture.user_id)).toMatchObject({
      error: { code: 'tool_blocked_by_workspace_policy' },
    });
  });

  it('refuses an ask that nothing held, rather than holding it here', async () => {
    await write_mode('ask');
    expect(await check_policy(fixture.user_id)).toMatchObject({
      error: { code: 'approval_required' },
    });
  });

  it('lets an allowed call through untouched', async () => {
    await write_mode('allow');
    expect(await check_policy(fixture.user_id)).toBeNull();
  });
});

describe('spending an approval', () => {
  it('runs the approved call once, then reports the approval as spent', async () => {
    await write_mode('ask');
    const source_context = await approved_source_context();

    expect(await check_policy(fixture.user_id, source_context)).toBeNull();
    expect(await check_policy(fixture.user_id, source_context)).toMatchObject({
      error: { code: 'approval_already_spent' },
    });
  });

  it('refuses an approval given for different input', async () => {
    await write_mode('ask');
    const source_context = await approved_source_context();

    expect(
      await check_policy(fixture.user_id, source_context, { order_id: '9999', amount: 240 }),
    ).toMatchObject({ error: { code: 'approval_required' } });
  });
});

describe('a permission for an answer already given', () => {
  it('opens the gate every time the run makes the same call', async () => {
    await write_mode('ask');
    const source_context = already_given(
      'stripe-refund-1',
      hash_tool_input_for_approval(fixture.tool_input),
    );

    expect(await check_policy(fixture.user_id, source_context)).toBeNull();
    expect(await check_policy(fixture.user_id, source_context)).toBeNull();
  });

  it('refuses the same permission held up against different input', async () => {
    await write_mode('ask');
    const source_context = already_given(
      'stripe-refund-1',
      hash_tool_input_for_approval(fixture.tool_input),
    );

    expect(
      await check_policy(fixture.user_id, source_context, { order_id: '9999', amount: 240 }),
    ).toMatchObject({ error: { code: 'approval_required' } });
  });

  it('reads the permission for the input the tool will receive, not the bytes handed to it', async () => {
    await set_policy(fixture.db, {
      workspace_id: fixture.workspace_id,
      resource_type: 'node',
      resource_id: 'math-calculate-1',
      scope_type: 'workspace',
      scope_id: fixture.workspace_id,
      policy_mode: 'ask',
      actor_id: fixture.user_id,
    });
    const permission = already_given(
      'math-calculate-1',
      hash_tool_input_for_approval(
        math_calculate_tool.validate_input.parse({ expression: '3 + 3' }),
      ),
    );

    expect(
      await find_tool_policy_error(fixture.db, {
        workspace_id: fixture.workspace_id,
        session_id: fixture.session_id,
        run_id: fixture.run_id,
        agent_id: fixture.agent_id,
        actor_id: fixture.user_id,
        node_key: 'math-calculate-1',
        tool_input: { expression: '3 + 3' },
        connection_id: null,
        approval_policy: { mode: 'none' },
        metadata: {},
        source_context: permission,
      }),
    ).toBeNull();
  });
});

function already_given(node_key: string, input_sha256: string) {
  return {
    source_type: 'runtime' as const,
    source_metadata: {
      policy_approval: {
        version: 1 as const,
        answer: 'already_given' as const,
        node_key,
        input_sha256,
      },
    },
  };
}

async function create_approval_wait() {
  const input_sha256 = hash_tool_input_for_approval(fixture.tool_input);
  const queue_key = tool_policy_wait_subject({
    run_id: fixture.run_id,
    approval_call_hashes: [input_sha256],
  });
  const created = await create_tool_policy_wait(fixture.db, {
    workspace_id: fixture.workspace_id,
    queue_key,
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: fixture.session_id,
      source_run_id: fixture.run_id,
      calls: [{ tool_call_id: approval_tool_call_id, input_sha256 }],
      requested_by: fixture.user_id,
      eligible_user_ids: [fixture.user_id],
    },
    actor_id: fixture.user_id,
  });
  return { created, input_sha256, queue_key };
}

async function approved_source_context() {
  const approval = await create_approval_wait();
  const decision = await enqueue_event_jobs(fixture.db, {
    workspace_id: fixture.workspace_id,
    source: 'policy',
    source_event_id: `${approval.created.event_job.job_id}:decision`,
    event_type: policy_decision_event_type,
    queue_key: approval.queue_key,
    actor_key: fixture.user_id,
    event_body: { job_id: approval.created.event_job.job_id, decision: 'approved' },
  });
  await claim_ready_event_jobs_for_queue(fixture.db, {
    workspace_id: fixture.workspace_id,
    queue_key: approval.queue_key,
    worker_id: 'worker_test',
  });
  return {
    source_type: 'runtime' as const,
    source_metadata: {
      policy_approval: {
        version: 1 as const,
        job_id: approval.created.event_job.job_id,
        node_key: 'stripe-refund-1',
        input_sha256: approval.input_sha256,
        decision_event_id: decision.event.event_id,
        tool_call_id: approval_tool_call_id,
      },
    },
  };
}

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  return {
    db,
    workspace_id: bootstrap.workspace_id,
    user_id: bootstrap.user_id,
    agent_id: bootstrap.agent_id,
    session_id: session.session_id,
    run_id: 'run_policy_test',
    tool_input: { order_id: '4471', amount: 240 },
  };
}

function write_mode(policy_mode: 'allow' | 'ask' | 'never') {
  return set_policy(fixture.db, {
    workspace_id: fixture.workspace_id,
    resource_type: 'node',
    resource_id: 'stripe-refund-1',
    scope_type: 'workspace',
    scope_id: fixture.workspace_id,
    policy_mode,
    actor_id: fixture.user_id,
  });
}

function check_policy(
  actor_id: string,
  source_context?: Parameters<typeof find_tool_policy_error>[1]['source_context'],
  tool_input: unknown = fixture.tool_input,
) {
  return find_tool_policy_error(fixture.db, {
    workspace_id: fixture.workspace_id,
    session_id: fixture.session_id,
    run_id: fixture.run_id,
    agent_id: fixture.agent_id,
    actor_id,
    node_key: 'stripe-refund-1',
    tool_input,
    connection_id: null,
    approval_policy: { mode: 'manual_review' },
    metadata: { policy_labels: ['spends_money'] },
    ...(source_context ? { source_context } : {}),
  });
}
