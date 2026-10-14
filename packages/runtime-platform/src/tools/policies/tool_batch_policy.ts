import type {
  DecideRuntimeToolBatch,
  RuntimeToolBatchAnswer,
  RuntimeToolBatchDecision,
  RuntimeToolDefinition,
} from '@agent-core/tools/runtime_tool';
import type { Database } from '@coworker/core';
import { read_policy_scope_ids } from '@coworker/core/access/policy_scope_context';
import { resolve_tool_policy_modes } from '@coworker/core/access/resolve_tool_policies';
import {
  read_calls_a_person_is_asked_about,
  tool_policy_approval_wait_schema,
} from '@coworker/core/access/tool_policy_approval_schema';
import { find_approval_answer } from '@coworker/core/db/queries/approval_answers';
import {
  create_tool_policy_wait,
  get_tool_policy_wait,
  hash_tool_input_for_approval,
  new_approval_request_id,
  tool_policy_wait_subject,
  withdraw_superseded_tool_policy_waits,
} from '@coworker/core/db/queries/event_waits';
import { record_run_wait } from '@coworker/core/db/queries/run_suspension';
import { session_approval_grants } from '@coworker/core/db/queries/session_approval_grants';
import { get_session, get_tool_call } from '@coworker/core/db/queries/sessions';
import type {
  ToolPolicyApprovalCallData,
  ToolPolicyApprovalGrantData,
  ToolPolicyApprovalWaitDataV2,
} from '@coworker/core/db/schema/json_column_types';
import type { PolicyMode } from '@coworker/core/db/schema/policies';
import { create_logger, format_error_message } from '@coworker/shared';
import { write_notification } from '@runtime-platform/notifications/write_notification';
import { send_approval_cards } from '@runtime-platform/tools/policies/approval_delivery';
import {
  record_step_awaiting_approval,
  record_tool_call_awaiting_approval,
  refuse_tool_call,
  type ToolCallApprovalContext,
} from '@runtime-platform/tools/policies/tool_call_awaiting_approval';
import {
  type FindRunTool,
  read_tool_policy_call_targets,
  type ToolPolicyCallTarget,
} from '@runtime-platform/tools/policies/tool_policy_call';
import {
  approval_wait_window_ms_for_session,
  wait_for_the_person,
} from '@runtime-platform/tools/policies/wait_for_the_person';
import { read_automation_id } from '@runtime-platform/tools/source_metadata';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

const log = create_logger('tool_batch_policy');

export type ToolBatchPolicyContext = ToolCallApprovalContext & {
  acting_actor_id?: string;
  participants?: Parameters<typeof read_tool_policy_call_targets>[1]['participants'];
  room_private_to?: string | null | undefined;
  source_context?: RuntimeToolSourceContext;
  resumed_from_job_id?: string;
};

export type ToolBatchPolicy = {
  decide: DecideRuntimeToolBatch;
  read_approval_grant(model_tool_call_id: string): ToolPolicyApprovalGrantData | undefined;
  set_run_tools(tools: readonly RuntimeToolDefinition[]): void;
};

export function create_tool_batch_policy(
  db: Database,
  context: ToolBatchPolicyContext,
): ToolBatchPolicy {
  const grant_by_model_tool_call_id = new Map<string, ToolPolicyApprovalGrantData>();
  const approved_this_run = new Set<string>();
  const carried = carry_the_answer_that_woke_this_run(db, context);
  let run_tool_by_name = new Map<string, RuntimeToolDefinition>();

  return {
    read_approval_grant: (model_tool_call_id) =>
      grant_by_model_tool_call_id.get(model_tool_call_id),
    set_run_tools: (tools) => {
      run_tool_by_name = new Map(tools.map((tool) => [tool.tool_name, tool]));
    },
    decide: async (calls) => {
      try {
        for (const node_key of await carried) approved_this_run.add(node_key);
        return await decide_the_turn(db, context, calls, {
          grants: grant_by_model_tool_call_id,
          approved_this_run,
          find_run_tool: (tool_name) => run_tool_by_name.get(tool_name),
        });
      } catch (error) {
        log.error('deciding the tool policy for this turn failed', {
          workspace_id: context.workspace_id,
          run_id: context.run_id,
          error: format_error_message(error),
        });
        return refused_outright(
          'This step did not run: the permission check failed, so nothing was executed. Report this and stop.',
        );
      }
    },
  };
}

async function carry_the_answer_that_woke_this_run(
  db: Database,
  context: ToolBatchPolicyContext,
): Promise<ReadonlySet<string>> {
  const job_id = context.resumed_from_job_id;
  if (!job_id) return new Set();

  try {
    const wait = await get_tool_policy_wait(db, { workspace_id: context.workspace_id, job_id });
    if (!wait) return new Set();
    const approval = tool_policy_approval_wait_schema.parse(wait.metadata.policy_approval);
    const answer = await find_approval_answer(db, {
      workspace_id: context.workspace_id,
      job_id,
      queue_key: wait.awaits_queue_key ?? wait.queue_key,
    });
    if (answer?.decision !== 'approved') return new Set();

    const shown = await Promise.all(
      read_calls_a_person_is_asked_about(approval).map((call) =>
        get_tool_call(db, context.workspace_id, call.tool_call_id),
      ),
    );
    return new Set(shown.flatMap((call) => (call ? [call.tool_name] : [])));
  } catch (error) {
    log.warn('reading the answer this run was resumed from failed', {
      workspace_id: context.workspace_id,
      run_id: context.run_id,
      job_id,
      error: format_error_message(error),
    });
    return new Set();
  }
}

async function decide_the_turn(
  db: Database,
  context: ToolBatchPolicyContext,
  calls: Parameters<DecideRuntimeToolBatch>[0],
  turn: {
    grants: Map<string, ToolPolicyApprovalGrantData>;
    approved_this_run: Set<string>;
    find_run_tool: FindRunTool;
  },
): Promise<RuntimeToolBatchDecision> {
  const { targets, unknown_tool_names } = await read_tool_policy_call_targets(
    db,
    context,
    [...calls],
    turn.find_run_tool,
  );
  if (unknown_tool_names.length > 0)
    return refused_outright(unknown_tools_message(unknown_tool_names));
  if (targets.length === 0) return { kind: 'run' };

  const modes = await resolve_tool_policy_modes(db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    ...(context.agent_id ? { agent_id: context.agent_id } : {}),
    actor_id: context.actor_id,
    ...(context.acting_actor_id ? { acting_actor_id: context.acting_actor_id } : {}),
    automation_id: read_automation_id(context.source_context),
    tools: targets,
  });
  const asks = targets.filter((target) => read_mode(modes, target) === 'ask');
  if (asks.length === 0) return { kind: 'run' };

  const already_said_yes_to = await read_what_a_person_already_said_yes_to(db, context, {
    asks,
    approved_this_run: turn.approved_this_run,
  });
  const need_a_person = asks.filter((target) => !already_said_yes_to.has(target.node_key));
  if (need_a_person.length === 0) {
    for (const target of asks) turn.grants.set(target.tool_call_id, answer_already_given(target));
    return { kind: 'run' };
  }

  const deciders = await read_eligible_user_ids(db, context);
  if (deciders.length === 0) return refused_outright(nobody_can_answer_message(need_a_person));

  return ask_the_person(db, context, {
    targets,
    need_a_person,
    deciders,
    grants: turn.grants,
    approved_this_run: turn.approved_this_run,
  });
}

async function read_what_a_person_already_said_yes_to(
  db: Database,
  context: ToolBatchPolicyContext,
  input: { asks: ToolPolicyCallTarget[]; approved_this_run: ReadonlySet<string> },
): Promise<ReadonlySet<string>> {
  if (input.asks.every((target) => input.approved_this_run.has(target.node_key))) {
    return input.approved_this_run;
  }

  const session = await get_session(db, context.workspace_id, context.session_id);
  const granted_in_this_chat = session
    ? session_approval_grants(session.session_metadata)
    : new Set<string>();
  return new Set([...input.approved_this_run, ...granted_in_this_chat]);
}

function answer_already_given(target: ToolPolicyCallTarget): ToolPolicyApprovalGrantData {
  return {
    version: 1,
    answer: 'already_given',
    node_key: target.node_key,
    input_sha256: hash_tool_input_for_approval(target.tool_input),
  };
}

async function ask_the_person(
  db: Database,
  context: ToolBatchPolicyContext,
  input: {
    targets: ToolPolicyCallTarget[];
    need_a_person: ToolPolicyCallTarget[];
    deciders: string[];
    grants: Map<string, ToolPolicyApprovalGrantData>;
    approved_this_run: Set<string>;
  },
): Promise<RuntimeToolBatchDecision> {
  const job_id = new_approval_request_id();
  const asked_about = new Set(input.need_a_person.map((target) => target.tool_call_id));
  const recorded = await Promise.all(
    input.targets.map((target) =>
      record_tool_call_awaiting_approval(db, context, {
        target,
        approval_request_id: job_id,
        eligible_user_ids: input.deciders,
        needs_a_person: asked_about.has(target.tool_call_id),
      }),
    ),
  );
  const approval_calls: ToolPolicyApprovalCallData[] = recorded.map((record, index) => ({
    tool_call_id: record.tool_call.tool_call_id,
    input_sha256: hash_tool_input_for_approval(input.targets[index]?.tool_input),
    needs_a_person: asked_about.has(input.targets[index]?.tool_call_id ?? ''),
  }));

  const queue_key = tool_policy_wait_subject({
    run_id: context.run_id,
    approval_call_hashes: approval_calls.map((call) => call.input_sha256),
  });
  const wait: ToolPolicyApprovalWaitDataV2 = {
    version: 2,
    kind: 'tool_policy_approval',
    session_id: context.session_id,
    source_run_id: context.run_id,
    calls: approval_calls,
    requested_by: context.actor_id.startsWith('user_') ? context.actor_id : null,
    eligible_user_ids: input.deciders,
  };
  const [written] = await Promise.all([
    create_tool_policy_wait(db, {
      workspace_id: context.workspace_id,
      queue_key,
      wait,
      job_id,
      actor_id: wait.requested_by ?? context.actor_id,
    }),
    record_run_wait(db, {
      workspace_id: context.workspace_id,
      run_id: context.run_id,
      job_id,
      actor_id: context.actor_id,
    }),
    context.emit_chat_stream_event_drafts?.(recorded.flatMap((record) => record.chat_event_drafts)),
  ]);

  if (written.created) {
    await record_step_awaiting_approval(db, context, {
      approval_request_id: job_id,
      tool_call_ids: approval_calls.map((call) => call.tool_call_id),
    });
  }

  await withdraw_superseded_tool_policy_waits(db, {
    workspace_id: context.workspace_id,
    wait: written.event_job,
    actor_id: wait.requested_by ?? context.actor_id,
  });

  if (written.created) {
    void send_approval_cards(db, {
      workspace_id: context.workspace_id,
      wait: written.event_job,
    }).catch((error: unknown) => {
      log.warn('sending the approval cards failed', {
        workspace_id: context.workspace_id,
        job_id,
        error: format_error_message(error),
      });
    });
  }

  if (written.created) {
    await mirror_the_hold_as_a_notification(db, context, {
      job_id,
      need_a_person: input.need_a_person,
      awaits_until_time: written.event_job.awaits_until_time,
    });
  }

  return {
    kind: 'needs_approval',
    wait_for_answer: (signal) =>
      read_the_answer(db, context, { job_id, queue_key, approval_calls, input, signal }),
  };
}

async function mirror_the_hold_as_a_notification(
  db: Database,
  context: ToolBatchPolicyContext,
  input: {
    job_id: string;
    need_a_person: ToolPolicyCallTarget[];
    awaits_until_time: Date | null;
  },
) {
  if (!context.agent_id) return;
  try {
    await write_notification(db, {
      workspace_id: context.workspace_id,
      agent_id: context.agent_id,
      actor_id: 'system:approval_mirror',
      written_by: 'platform',
      notification: {
        automation_id: read_automation_id(context.source_context),
        run_id: context.run_id,
        session_id: context.session_id,
        subject: `approval:${input.job_id}`,
        claim: 'is waiting for a yes',
        title: `Waiting for your yes on ${name_the_tools(input.need_a_person)}`,
        body: [
          `A step is held until somebody answers: ${name_the_tools(input.need_a_person)}.`,
          input.awaits_until_time
            ? `It stops waiting at ${input.awaits_until_time.toISOString()}.`
            : 'It waits until somebody answers.',
        ].join(' '),
        urgency: 'deadline',
        expires_time: input.awaits_until_time?.toISOString() ?? null,
        evidence: { run_ids: [context.run_id] },
        proposed_action: { kind: 'approve_held_call', job_id: input.job_id },
        score: 80,
        reason: 'a run is held waiting for a person to answer',
      },
    });
  } catch (error) {
    log.warn('the held step could not be mirrored as a notification', {
      workspace_id: context.workspace_id,
      job_id: input.job_id,
      error: format_error_message(error),
    });
  }
}

async function read_the_answer(
  db: Database,
  context: ToolBatchPolicyContext,
  input: {
    job_id: string;
    queue_key: string;
    approval_calls: ToolPolicyApprovalCallData[];
    input: {
      targets: ToolPolicyCallTarget[];
      grants: Map<string, ToolPolicyApprovalGrantData>;
      approved_this_run: Set<string>;
    };
    signal: AbortSignal | undefined;
  },
): Promise<RuntimeToolBatchAnswer> {
  const session = await get_session(db, context.workspace_id, context.session_id);
  const waited = await wait_for_the_person(db, {
    workspace_id: context.workspace_id,
    job_id: input.job_id,
    queue_key: input.queue_key,
    actor_id: context.actor_id,
    signal: input.signal,
    window_ms: approval_wait_window_ms_for_session(session?.session_source),
  });
  if (!waited.answered) {
    return { answer: 'unanswered', message: nobody_answered_yet_message() };
  }

  if (waited.answer.decision === 'denied') {
    const reason = waited.answer.reason;
    for (const call of input.approval_calls) {
      await refuse_tool_call(db, context, {
        tool_call_id: call.tool_call_id,
        decision_event_id: waited.answer.decision_event_id,
        reason,
      });
    }
    return { answer: 'refused', message: refused_message(input.input.targets, reason) };
  }

  for (const [index, target] of input.input.targets.entries()) {
    const call = input.approval_calls[index];
    if (!call) continue;
    if (call.needs_a_person !== false) {
      input.input.approved_this_run.add(target.node_key);
    }
    input.input.grants.set(target.tool_call_id, {
      version: 1,
      job_id: input.job_id,
      node_key: target.node_key,
      input_sha256: call.input_sha256,
      decision_event_id: waited.answer.decision_event_id,
      tool_call_id: call.tool_call_id,
    });
  }
  return { answer: 'approved' };
}

async function read_eligible_user_ids(db: Database, context: ToolBatchPolicyContext) {
  const scopes = await read_policy_scope_ids(db, {
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    ...(context.agent_id ? { agent_id: context.agent_id } : {}),
    actor_id: context.actor_id,
    ...(context.acting_actor_id ? { acting_actor_id: context.acting_actor_id } : {}),
  });
  return [...scopes.user];
}

function read_mode(modes: Map<string, PolicyMode>, target: ToolPolicyCallTarget) {
  return modes.get(target.node_key) ?? 'allow';
}

function refused_outright(message: string): RuntimeToolBatchDecision {
  return {
    kind: 'needs_approval',
    wait_for_answer: async () => ({ answer: 'refused', message }),
  };
}

function refused_message(targets: ToolPolicyCallTarget[], reason?: string | null) {
  const said_why = reason?.trim();
  return [
    `A person said no to this step, so ${name_the_tools(targets)} did not run.`,
    ...(said_why ? [`They said: ${said_why}`] : []),
    'Do not try it again. Continue with the work you are allowed to do, and say what you could not do.',
  ].join(' ');
}

function nobody_answered_yet_message() {
  return [
    'This step is still waiting for a person and nothing in it has run.',
    'Stop here. It continues on its own once somebody answers.',
  ].join(' ');
}

function unknown_tools_message(tool_names: string[]) {
  return [
    `This step did not run: ${tool_names.join(', ')} is not a tool this run has,`,
    'so the permission check could not be made and nothing was executed.',
    'Report this and stop.',
  ].join(' ');
}

function nobody_can_answer_message(need_a_person: ToolPolicyCallTarget[]) {
  return [
    `This step did not run. ${name_the_tools(need_a_person)} needs a person's approval,`,
    'and this run has nobody who can give it.',
    'Continue only with work that does not need approval, and say what you could not do.',
  ].join(' ');
}

function name_the_tools(targets: ToolPolicyCallTarget[]) {
  return targets.map((target) => target.node_key).join(', ');
}
