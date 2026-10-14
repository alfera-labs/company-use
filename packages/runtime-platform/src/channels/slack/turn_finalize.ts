import type { Database } from '@coworker/core';
import { list_run_files } from '@coworker/core/db/queries/files';
import {
  claim_run_turn_finalize,
  create_run_message,
  list_run_messages,
  list_run_tool_calls,
  record_run_turn_finalize_outcome,
} from '@coworker/core/db/queries/sessions';
import { create_logger, format_error_message } from '@coworker/shared';
import { slack_turn_failure_text } from '@runtime-platform/channels/slack/turn_failure';
import { post_slack_turn_message } from '@runtime-platform/channels/slack/turn_message_post';
import {
  type SlackTurnRecoveryMessage,
  type SlackTurnResolutionToolCall,
  select_slack_turn_recovered_reply,
  slack_turn_was_resolved,
} from '@runtime-platform/channels/slack/turn_resolution';
import {
  type SlackTurnSynthesisArtifact,
  type SlackTurnSynthesisInput,
  synthesize_slack_turn_reply,
} from '@runtime-platform/channels/slack/turn_synthesis';
import {
  restore_run_message_tool_results,
  restore_tool_call_outputs,
} from '@runtime-platform/tools/stored_tool_result_reads';
import type { WebClient } from '@slack/web-api';

const log = create_logger('slack_turn_finalize');

const unresolved_turn_slack_text =
  "I finished working on that but couldn't post a reply. Send it again and I'll pick it back up.";

export type SlackTurnFinalizeInput = {
  slack_api: WebClient;
  workspace_id: string;
  run_id: string;
  run_status: string;
  run_error_message?: string | null;
  channel_id: string;
  thread_ts: string;
  stream_message_ts?: string;
  actor_id: string;
  finalized_by: string;
  synthesize_reply?: (input: SlackTurnSynthesisInput) => Promise<string | null>;
  evidence_readers?: Partial<SlackTurnFinalizeEvidenceReaders>;
};

type SlackTurnFinalizeEvidenceReaders = {
  list_tool_calls: (
    db: Database,
    workspace_id: string,
    run_id: string,
  ) => Promise<SlackTurnResolutionToolCall[]>;
  list_messages: (
    db: Database,
    workspace_id: string,
    run_id: string,
  ) => Promise<Array<SlackTurnRecoveryMessage & { session_id?: string }>>;
  list_files: (
    db: Database,
    workspace_id: string,
    run_id: string,
  ) => Promise<SlackTurnSynthesisArtifact[]>;
};

const default_evidence_readers: SlackTurnFinalizeEvidenceReaders = {
  list_tool_calls: async (db, workspace_id, run_id) =>
    restore_tool_call_outputs(db, {
      workspace_id,
      rows: await list_run_tool_calls(db, workspace_id, run_id),
      reading: 'load_full_value',
    }),
  list_messages: async (db, workspace_id, run_id) =>
    restore_run_message_tool_results(db, {
      workspace_id,
      rows: await list_run_messages(db, workspace_id, run_id),
      reading: 'load_full_value',
    }),
  list_files: list_run_files,
};

export type SlackTurnFinalizeResult = {
  finalized: boolean;
  outcome:
    | 'already_finalized'
    | 'resolved_by_agent'
    | 'delivered_recovered_reply'
    | 'posted_unresolved_notice'
    | 'posted_run_failure_notice'
    | 'post_failed';
  delivery_duration_ms?: number;
};

export async function finalize_slack_channel_turn(
  db: Database,
  input: SlackTurnFinalizeInput,
): Promise<SlackTurnFinalizeResult> {
  const plan = await plan_slack_turn_finalize(db, input);
  if (plan.outcome === 'resolved_by_agent')
    return { finalized: true, outcome: 'resolved_by_agent' };

  const claimed = await claim_run_turn_finalize(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    claimed_by: input.finalized_by,
  });
  if (!claimed) return { finalized: false, outcome: 'already_finalized' };

  const delivery_started_time = Date.now();
  const result = await post_planned_finalize(db, input, plan);
  const delivery_duration_ms = Math.max(1, Date.now() - delivery_started_time);
  await record_run_turn_finalize_outcome(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    outcome: result.outcome,
    outcome_data: { ...(result.outcome_data ?? {}), delivery_duration_ms },
  });
  return { finalized: true, outcome: result.outcome, delivery_duration_ms };
}

type PlannedFinalize =
  | { outcome: 'resolved_by_agent' }
  | { outcome: 'posted_run_failure_notice'; text: string }
  | { outcome: 'posted_unresolved_notice'; text: string }
  | { outcome: 'delivered_recovered_reply'; text: string; reply_source: string }
  | { outcome: 'needs_synthesis'; session_id: string; synthesis: SlackTurnSynthesisInput };

async function plan_slack_turn_finalize(
  db: Database,
  input: SlackTurnFinalizeInput,
): Promise<PlannedFinalize> {
  if (input.run_status !== 'completed') {
    return {
      outcome: 'posted_run_failure_notice',
      text: slack_turn_failure_text(input.run_status),
    };
  }

  const evidence_readers = {
    list_tool_calls:
      input.evidence_readers?.list_tool_calls ?? default_evidence_readers.list_tool_calls,
    list_messages: input.evidence_readers?.list_messages ?? default_evidence_readers.list_messages,
    list_files: input.evidence_readers?.list_files ?? default_evidence_readers.list_files,
  };
  const tool_calls = await evidence_readers.list_tool_calls(db, input.workspace_id, input.run_id);
  if (slack_turn_was_resolved({ turn_channel_id: input.channel_id, tool_calls })) {
    return { outcome: 'resolved_by_agent' };
  }

  const run_messages = await evidence_readers.list_messages(db, input.workspace_id, input.run_id);

  log.error('run completed without resolving the Slack turn', {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    channel_id: input.channel_id,
    finalized_by: input.finalized_by,
  });
  const recovered = select_slack_turn_recovered_reply({
    turn_channel_id: input.channel_id,
    tool_calls,
    run_messages,
  });
  if (recovered) {
    return {
      outcome: 'delivered_recovered_reply',
      text: recovered.message,
      reply_source: recovered.reply_source,
    };
  }

  const session_id = run_messages[0]?.session_id;
  if (tool_calls.length > 0 && session_id) {
    const files = await evidence_readers.list_files(db, input.workspace_id, input.run_id);
    return {
      outcome: 'needs_synthesis',
      session_id,
      synthesis: {
        workspace_id: input.workspace_id,
        run_id: input.run_id,
        run_messages,
        tool_calls,
        files,
      },
    };
  }
  return { outcome: 'posted_unresolved_notice', text: unresolved_turn_slack_text };
}

type ClaimedTurnOutcome = {
  outcome: Exclude<SlackTurnFinalizeResult['outcome'], 'already_finalized'>;
  outcome_data?: Record<string, unknown>;
};

async function post_planned_finalize(
  db: Database,
  input: SlackTurnFinalizeInput,
  plan: Exclude<PlannedFinalize, { outcome: 'resolved_by_agent' }>,
): Promise<ClaimedTurnOutcome> {
  if (plan.outcome === 'needs_synthesis') {
    return deliver_synthesized_reply(db, input, plan);
  }
  if (plan.outcome === 'delivered_recovered_reply') {
    try {
      const posted = await post_slack_turn_message(input.slack_api, input, { text: plan.text });
      return {
        outcome: 'delivered_recovered_reply',
        outcome_data: {
          reply_source: plan.reply_source,
          ...(typeof posted.ts === 'string' ? { message_ts: posted.ts } : {}),
        },
      };
    } catch (error) {
      return post_notice(input, unresolved_turn_slack_text, 'posted_unresolved_notice', {
        recovered_reply_error: format_error_message(error),
      });
    }
  }
  return post_notice(input, plan.text, plan.outcome, {});
}

async function deliver_synthesized_reply(
  db: Database,
  input: SlackTurnFinalizeInput,
  plan: Extract<PlannedFinalize, { outcome: 'needs_synthesis' }>,
): Promise<ClaimedTurnOutcome> {
  let synthesized: string | null;
  try {
    synthesized = await (input.synthesize_reply ?? synthesize_slack_turn_reply)(plan.synthesis);
  } catch (error) {
    log.error('synthesizing the Slack turn reply failed', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      synthesis_error: format_error_message(error),
    });
    return post_notice(input, unresolved_turn_slack_text, 'posted_unresolved_notice', {
      synthesis_error: format_error_message(error),
    });
  }
  if (!synthesized) {
    return post_notice(input, unresolved_turn_slack_text, 'posted_unresolved_notice', {
      synthesis_empty: true,
    });
  }

  let posted: { ok: boolean; ts?: string };
  try {
    posted = await post_slack_turn_message(input.slack_api, input, { text: synthesized });
  } catch (error) {
    return post_notice(input, unresolved_turn_slack_text, 'posted_unresolved_notice', {
      recovered_reply_error: format_error_message(error),
    });
  }

  try {
    await create_run_message(db, {
      workspace_id: input.workspace_id,
      session_id: plan.session_id,
      run_id: input.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text: synthesized },
      source_type: 'runtime',
      source_metadata: { final_synthesis: true, tools_enabled: false },
      is_user_visible: true,
      is_model_visible: true,
      actor_id: input.actor_id,
    });
  } catch (error) {
    log.error('saving the synthesized Slack reply failed after it was posted', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      persist_error: format_error_message(error),
    });
  }

  return {
    outcome: 'delivered_recovered_reply',
    outcome_data: {
      reply_source: 'final_synthesis',
      ...(typeof posted.ts === 'string' ? { message_ts: posted.ts } : {}),
    },
  };
}

async function post_notice(
  input: SlackTurnFinalizeInput,
  text: string,
  outcome: 'posted_unresolved_notice' | 'posted_run_failure_notice',
  outcome_data: Record<string, unknown>,
): Promise<ClaimedTurnOutcome> {
  try {
    await post_slack_turn_message(input.slack_api, input, { text });
    return { outcome, outcome_data };
  } catch (error) {
    return post_failed(input, { ...outcome_data, notice_error: format_error_message(error) });
  }
}

function post_failed(
  input: SlackTurnFinalizeInput,
  outcome_data: Record<string, unknown>,
): ClaimedTurnOutcome {
  log.error('finalizing the Slack turn could not post to Slack', {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    channel_id: input.channel_id,
    ...outcome_data,
  });
  return { outcome: 'post_failed', outcome_data };
}
