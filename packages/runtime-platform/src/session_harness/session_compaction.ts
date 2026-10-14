import {
  type PiCompactionSettings,
  pi_compaction_settings_for_token_budget,
  prepare_pi_compaction,
  run_pi_compaction,
} from '@agent-core/engines/pi';
import type { RuntimeRunProgressEvent } from '@agent-core/events/runtime_event';
import {
  model_config_without_credential,
  type RuntimeModelConfig,
} from '@agent-core/models/runtime_model_config';
import type { RuntimeRunUsage } from '@agent-core/runs/run_usage';
import type { Database, DatabaseExecutor } from '@coworker/core';
import {
  create_run_model_context_snapshot,
  create_session_context_operation,
  get_session,
  list_session_messages,
  update_session_context_summary,
} from '@coworker/core/db/queries/sessions';
import { create_logger, format_error_message } from '@coworker/shared';
import { session_context_token_budget_for_model } from '@runtime-platform/orchestrator/context/context_budget';
import { prepare_context_snapshot_value } from '@runtime-platform/orchestrator/context/stored_context_snapshot';
import { create_stored_run_event } from '@runtime-platform/orchestrator/stored_run_event_payloads';
import { preserve_compaction_anchors } from '@runtime-platform/session_harness/session_compaction_anchors';
import { resolve_session_compaction_model } from '@runtime-platform/session_harness/session_compaction_model';
import { record_session_compaction_spend } from '@runtime-platform/session_harness/session_compaction_spend';
import {
  type SessionCompactionTierName,
  session_compaction_tier_token_budget,
  session_compaction_tiers,
} from '@runtime-platform/session_harness/session_compaction_tier';
import {
  count_model_visible_messages,
  find_summarized_until_message_id,
  type HarnessProjection,
  type HarnessRunMessage,
  project_run_messages_to_pi_session_entries,
} from '@runtime-platform/session_harness/session_entries';
import { restore_run_message_tool_results } from '@runtime-platform/tools/stored_tool_result_reads';

const log = create_logger('session_compaction');

export { preserve_compaction_anchors };

export type SessionCompactionOutcome =
  | { status: 'not_needed'; reason: string; context_tokens?: number; context_window?: number }
  | {
      status: 'compacted';
      context_tokens: number;
      context_window: number;
      summarized_until_message_id: string | null;
      first_kept_entry_id: string;
      event?: RuntimeRunProgressEvent;
    }
  | { status: 'superseded' }
  | { status: 'failed'; error_message: string };

type PreparedSessionCompaction =
  | SessionCompactionOutcome
  | {
      status: 'prepared';
      messages: HarnessRunMessage[];
      projection: HarnessProjection;
      plan: Extract<ReturnType<typeof prepare_pi_compaction>, { status: 'prepared' }>;
      settings: PiCompactionSettings;
    };

export type SessionCompactionInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  context_summary?: string | null;
  summarized_until_message_id?: string | null;
  model: RuntimeModelConfig;
  actor_id: string;
  tier?: SessionCompactionTierName;
  settings?: PiCompactionSettings;
};

export async function maybe_compact_session_context(
  db: Database,
  input: SessionCompactionInput,
): Promise<SessionCompactionOutcome> {
  try {
    return await compact_session_context(db, input);
  } catch (error) {
    return { status: 'failed', error_message: format_error_message(error) };
  }
}

const sessions_compacting_in_background = new Set<string>();

export type BackgroundSessionCompactionInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  model: RuntimeModelConfig;
  actor_id: string;
};

export function start_background_session_compaction(
  db: Database,
  input: BackgroundSessionCompactionInput,
): Promise<void> {
  if (sessions_compacting_in_background.has(input.session_id)) return Promise.resolve();
  sessions_compacting_in_background.add(input.session_id);

  return compact_session_context_in_background(db, input)
    .catch((error) => log.warn('background compaction failed:', format_error_message(error)))
    .finally(() => sessions_compacting_in_background.delete(input.session_id));
}

async function compact_session_context_in_background(
  db: Database,
  input: BackgroundSessionCompactionInput,
) {
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) return;

  const outcome = await maybe_compact_session_context(db, {
    ...input,
    context_summary: session.context_summary,
    summarized_until_message_id: session.summarized_until_message_id,
    tier: 'soft',
  });
  if (outcome.status === 'failed') log.warn('background compaction failed:', outcome.error_message);
}

const session_compaction_instructions = [
  'When summarizing this session:',
  '- Quote user instructions verbatim and attribute each to the message that carried it. Never paraphrase an instruction into a different task.',
  '- An instruction the transcript shows satisfied is a completed outcome. Record it past-tense ("sent X at 19:30"); never list it as outstanding.',
  '- Never promote a one-off, point-in-time instruction into a standing constraint or preference. Constraints are only rules the user stated as always applying.',
  '- Never assert an outcome the transcript does not show. If completion is ambiguous, say it is ambiguous.',
  '- Keep exact identifiers verbatim: file paths, record/document/thread ids, email addresses, template names and their bodies when short.',
].join('\n');

async function compact_session_context(
  db: Database,
  input: SessionCompactionInput,
): Promise<SessionCompactionOutcome> {
  const preparation = await prepare_session_compaction(db, input);
  if (preparation.status !== 'prepared') return preparation;

  const summariser_model = resolve_session_compaction_model(input.model);
  const result = await run_pi_compaction({
    preparation: preparation.plan.preparation,
    model: summariser_model,
    custom_instructions: session_compaction_instructions,
  });
  if (!result.ok) return { status: 'failed', error_message: result.error.message };
  const first_kept_entry_id =
    result.value.firstKeptEntryId ?? preparation.plan.preparation.firstKeptEntryId;

  const summarized_until_message_id = find_summarized_until_message_id({
    entries: preparation.projection.entries,
    first_kept_entry_id,
    previous_summarized_until_message_id: input.summarized_until_message_id ?? null,
  });
  const persisted = await persist_compaction_result(db, input, {
    summary: preserve_compaction_anchors(result.value.summary, preparation.messages),
    summarized_until_message_id,
    first_kept_entry_id,
    summariser_model,
    tokens_before: result.value.tokensBefore || preparation.plan.context_tokens,
    context_tokens: preparation.plan.context_tokens,
    context_window: preparation.plan.context_window,
    details: result.value.details,
    settings: preparation.settings,
  });
  await record_summariser_spend(db, input, {
    summariser_model,
    usage: result.value.usage,
    summary_persisted: persisted !== null,
  });
  if (!persisted) return { status: 'superseded' };

  return compacted_outcome(preparation.plan, summarized_until_message_id, persisted);
}

async function record_summariser_spend(
  db: Database,
  input: SessionCompactionInput,
  result: {
    summariser_model: RuntimeModelConfig;
    usage: RuntimeRunUsage | undefined;
    summary_persisted: boolean;
  },
) {
  if (!result.usage) return;

  await record_session_compaction_spend(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    summariser_model: result.summariser_model,
    ...(input.tier ? { tier: input.tier } : {}),
    usage: result.usage,
    summary_persisted: result.summary_persisted,
    actor_id: input.actor_id,
  });
}

async function prepare_session_compaction(
  db: Database,
  input: SessionCompactionInput,
): Promise<PreparedSessionCompaction> {
  const messages = (await restore_run_message_tool_results(db, {
    workspace_id: input.workspace_id,
    rows: await list_session_messages(db, input.workspace_id, input.session_id),
    reading: 'load_model_visible_value',
  })) as HarnessRunMessage[];
  if (count_model_visible_messages(messages) === 0) {
    return { status: 'not_needed', reason: 'no_model_visible_messages' as const };
  }

  const projection = project_session_messages(input, messages);
  const settings =
    input.settings ??
    pi_compaction_settings_for_token_budget(input.model, compaction_token_budget(input));
  const plan = prepare_pi_compaction({ entries: projection.entries, model: input.model, settings });

  if (plan.status === 'not_needed') return not_needed_outcome(plan);
  return { status: 'prepared' as const, messages, projection, plan, settings };
}

function compaction_token_budget(input: SessionCompactionInput) {
  if (!input.tier) return session_context_token_budget_for_model(input.model);
  return session_compaction_tier_token_budget(input.tier, input.model);
}

function project_session_messages(input: SessionCompactionInput, messages: HarnessRunMessage[]) {
  return project_run_messages_to_pi_session_entries({
    messages,
    ...(input.context_summary === undefined ? {} : { context_summary: input.context_summary }),
    ...(input.summarized_until_message_id === undefined
      ? {}
      : { summarized_until_message_id: input.summarized_until_message_id }),
  });
}

function not_needed_outcome(plan: ReturnType<typeof prepare_pi_compaction>) {
  return {
    status: 'not_needed' as const,
    reason: 'below_pi_compaction_threshold',
    context_tokens: plan.context_tokens,
    context_window: plan.context_window,
  };
}

function compacted_outcome(
  plan: Extract<ReturnType<typeof prepare_pi_compaction>, { status: 'prepared' }>,
  summarized_until_message_id: string | null,
  event: RuntimeRunProgressEvent,
): SessionCompactionOutcome {
  return {
    status: 'compacted',
    context_tokens: plan.context_tokens,
    context_window: plan.context_window,
    summarized_until_message_id,
    first_kept_entry_id: plan.preparation.firstKeptEntryId,
    event,
  };
}

async function persist_compaction_result(
  db: Database,
  input: SessionCompactionInput,
  result: {
    summary: string;
    summarized_until_message_id: string | null;
    first_kept_entry_id: string;
    summariser_model: RuntimeModelConfig;
    tokens_before: number;
    context_tokens: number;
    context_window: number;
    details: unknown;
    settings: PiCompactionSettings;
  },
) {
  const snapshot_row = compaction_snapshot_row(input, result);
  const snapshot = await prepare_context_snapshot_value(db, snapshot_row);
  return db.transaction(async (transaction) => {
    const session = await update_session_context_summary(transaction, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      context_summary: result.summary,
      summarized_until_message_id: result.summarized_until_message_id,
      context_summary_metadata: compaction_metadata(input.run_id, result),
      expected_summarized_until_message_id: input.summarized_until_message_id ?? null,
      actor_id: input.actor_id,
    });
    if (!session) return null;

    await create_run_model_context_snapshot(transaction, { ...snapshot_row, snapshot });

    return persist_compaction_operation(transaction, input, result);
  });
}

async function persist_compaction_operation(
  db: DatabaseExecutor,
  input: SessionCompactionInput,
  result: Parameters<typeof persist_compaction_result>[2],
): Promise<RuntimeRunProgressEvent> {
  const operation_data = compaction_operation_data(input, result);
  const operation = await create_session_context_operation(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    operation_type: 'compact',
    target_entry_ids: compacted_entry_ids(result),
    operation_data,
    operation_reason: compaction_operation_reason(input.tier),
    metadata: { source: 'pi_agent_harness_compaction' },
    actor_id: input.actor_id,
  });

  const event = await create_stored_run_event(db, {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    event_type: 'progress',
    event_label: 'context_operation.compact',
    event_data: {
      operation_id: operation.session_context_operation_id,
      operation_type: operation.operation_type,
      target_entry_ids: operation.target_entry_ids,
      operation_data,
      operation_reason: operation.operation_reason,
    },
    event_metadata: { source: 'session_harness' },
    actor_id: input.actor_id,
  });

  return {
    event_id: event.run_event_id,
    event_sequence: event.event_sequence,
    run_key: input.run_id,
    session_key: input.session_id,
    event_type: 'progress',
    label: 'context_operation.compact',
    content: event.event_data,
    metadata: event.event_metadata as Record<string, unknown>,
  };
}

function compaction_operation_reason(tier?: SessionCompactionTierName) {
  if (!tier) return 'pi_context_budget_exceeded';
  return session_compaction_tiers[tier].operation_reason;
}

function compaction_metadata(
  run_id: string,
  result: Parameters<typeof persist_compaction_result>[2],
) {
  return {
    source: 'pi_agent_harness_compaction',
    run_id,
    summariser_model: model_config_without_credential(result.summariser_model),
    first_kept_entry_id: result.first_kept_entry_id,
    summarized_until_message_id: result.summarized_until_message_id,
    tokens_before: result.tokens_before,
    context_tokens: result.context_tokens,
    context_window: result.context_window,
    settings: result.settings,
  };
}

function compaction_snapshot_row(
  input: SessionCompactionInput,
  result: Parameters<typeof persist_compaction_result>[2],
) {
  return {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    snapshot_kind: 'compaction',
    model_provider: result.summariser_model.model_provider,
    model_name: result.summariser_model.model_name,
    message_count: 0,
    tool_count: 0,
    token_estimate: result.context_tokens,
    snapshot: compaction_snapshot(input, result),
    snapshot_metadata: {
      source: 'pi_agent_harness_compaction',
      first_kept_entry_id: result.first_kept_entry_id,
      summarized_until_message_id: result.summarized_until_message_id,
    },
    actor_id: input.actor_id,
  } satisfies Parameters<typeof create_run_model_context_snapshot>[1];
}

function compaction_snapshot(
  input: SessionCompactionInput,
  result: Parameters<typeof persist_compaction_result>[2],
) {
  return {
    snapshot_schema_version: 2,
    compaction_engine: 'pi_agent_harness',
    run_id: input.run_id,
    model: model_config_without_credential(input.model),
    summariser_model: model_config_without_credential(result.summariser_model),
    tier: input.tier ?? null,
    summary: result.summary,
    first_kept_entry_id: result.first_kept_entry_id,
    summarized_until_message_id: result.summarized_until_message_id,
    tokens_before: result.tokens_before,
    context_tokens: result.context_tokens,
    context_window: result.context_window,
    details: result.details,
    settings: result.settings,
  };
}

function compaction_operation_data(
  input: SessionCompactionInput,
  result: Parameters<typeof persist_compaction_result>[2],
) {
  return {
    run_id: input.run_id,
    model: model_config_without_credential(input.model),
    summariser_model: model_config_without_credential(result.summariser_model),
    tier: input.tier ?? null,
    summary: result.summary,
    first_kept_entry_id: result.first_kept_entry_id,
    summarized_until_message_id: result.summarized_until_message_id,
    tokens_before: result.tokens_before,
    context_tokens: result.context_tokens,
    context_window: result.context_window,
    settings: result.settings,
  };
}

function compacted_entry_ids(result: Parameters<typeof persist_compaction_result>[2]) {
  const summarized_until = result.summarized_until_message_id;
  return summarized_until ? [summarized_until] : [];
}
