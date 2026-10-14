import { create_agent_run } from '@agent-core';
import type { RuntimeRunEvent } from '@agent-core/events/runtime_event';
import type {
  RuntimeAgentMessage,
  RuntimeAgentMessagePart,
} from '@agent-core/messages/runtime_message';
import type { RuntimeReasoningLevel } from '@agent-core/models/runtime_model_config';
import type { AgentRunResult } from '@agent-core/runs/agent_run';
import { empty_run_usage, type RuntimeRunUsage } from '@agent-core/runs/run_usage';
import type { RuntimeToolDefinition as AgentRuntimeToolDefinition } from '@agent-core/tools';
import type { Database } from '@coworker/core';
import {
  describe_error_with_cause,
  find_database_error_details,
  workspace_billing_context_line,
} from '@coworker/core';
import { build_run_participants } from '@coworker/core/access/build_participants';
import { withdraw_run_tool_policy_waits } from '@coworker/core/db/queries/event_waits';
import {
  mark_run_completion_waiting,
  mark_run_waiting,
} from '@coworker/core/db/queries/run_suspension';
import {
  cancel_run,
  create_run,
  create_run_messages,
  get_run_cancel_intent,
  get_session,
  hide_run_messages_from_model,
  list_run_tool_calls,
  release_session_execution_lock,
  request_run_cancellation,
  update_run_performance_metrics,
  update_session_runtime_environment,
} from '@coworker/core/db/queries/sessions';
import { create_id, create_logger, id_prefixes, type MessageContent } from '@coworker/shared';
import { describe_hydrated_attachments } from '@runtime-platform/attachments/describe_hydrated_attachments';
import { hydrate_run_attachments } from '@runtime-platform/attachments/hydrate_run_attachments';
import { create_image_attachment_sources } from '@runtime-platform/attachments/image_attachment_sources';
import { create_inline_text_attachment_sources } from '@runtime-platform/attachments/inline_text_attachment_sources';
import {
  describe_message_text_file,
  write_message_text_file,
} from '@runtime-platform/attachments/message_text_file';
import {
  create_runtime_attachment_source_map,
  type RuntimeAttachmentSource,
} from '@runtime-platform/attachments/runtime_attachment_source';
import {
  type ChatStreamEvent,
  type ChatStreamEventDraft,
  create_chat_stream_event_projector,
} from '@runtime-platform/chat_stream/chat_stream_events';
import { create_chat_stream_event_recorder } from '@runtime-platform/chat_stream/chat_stream_snapshots';
import { start_memory_prompt_text } from '@runtime-platform/memory_host/memory_prompt_section';
import { create_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { AgentRunStoppedError } from '@runtime-platform/orchestrator/agent_run_stopped';
import { resolve_chat_speaker } from '@runtime-platform/orchestrator/chat_speaker';
import {
  get_current_connection_context,
  type SessionCurrentConnectionContext,
} from '@runtime-platform/orchestrator/context/current_connection_context';
import { store_run_model_context_snapshot } from '@runtime-platform/orchestrator/context/stored_context_snapshot';
import {
  get_workspace_library_context,
  type SessionWorkspaceLibraryContext,
} from '@runtime-platform/orchestrator/context/workspace_library_context';
import {
  build_session_context,
  create_model_context_snapshot,
  type SessionContextManagement,
} from '@runtime-platform/orchestrator/context_builder';
import { build_model_visible_current_turn_context } from '@runtime-platform/orchestrator/current_turn_context';
import {
  mark_run_cancelled,
  mark_run_completed,
  mark_run_failed,
  mark_run_running,
  record_runtime_event,
} from '@runtime-platform/orchestrator/event_persistence';
import { create_mid_run_credit_gate } from '@runtime-platform/orchestrator/mid_run_credit_gate';
import {
  cancel_active_agent_run,
  register_active_agent_run,
  wait_for_agent_run_to_stop,
} from '@runtime-platform/orchestrator/run_cancellation_registry';
import { open_run_hook_session } from '@runtime-platform/orchestrator/run_hook_session';
import type { RunHooks } from '@runtime-platform/orchestrator/run_hooks';
import { build_run_input_messages } from '@runtime-platform/orchestrator/run_input_messages';
import {
  resolve_run_model,
  runtime_model_from_resolved_model,
} from '@runtime-platform/orchestrator/run_model';
import { create_run_performance_tracker } from '@runtime-platform/orchestrator/run_performance';
import { finish_interrupted_tool_turn } from '@runtime-platform/orchestrator/run_resume';
import { create_run_spend_recorder } from '@runtime-platform/orchestrator/run_spend_once';
import { begin_run_start_credit_gates } from '@runtime-platform/orchestrator/run_start_credit_gates';
import {
  read_cancel_intent_before_start,
  settle_write,
} from '@runtime-platform/orchestrator/run_start_overlaps';
import { read_run_start_records } from '@runtime-platform/orchestrator/run_start_reads';
import { build_run_system_instructions } from '@runtime-platform/orchestrator/run_system_instructions';
import {
  finish_workspace_before_close,
  type WorkspaceCloseOwner,
} from '@runtime-platform/orchestrator/run_workspace_close';
import { record_runtime_error_event } from '@runtime-platform/orchestrator/runtime_error_event';
import {
  message_content_to_runtime_parts,
  runtime_message_parts_text,
} from '@runtime-platform/orchestrator/runtime_message_content';
import { create_saved_tool_call_turns } from '@runtime-platform/orchestrator/saved_tool_call_turns';
import {
  acquire_session_lock,
  type SessionLock,
} from '@runtime-platform/orchestrator/session_locker';
import { set_session_title_from_prompt } from '@runtime-platform/orchestrator/session_title';
import {
  type OpenedCodingWorkspace,
  open_or_create_coding_workspace,
  type WorkspaceRuntimeProvider,
} from '@runtime-platform/orchestrator/workspace_runtime';
import {
  maybe_compact_session_context,
  start_background_session_compaction,
} from '@runtime-platform/session_harness/session_compaction';
import { read_workspace_skill_index } from '@runtime-platform/skills/read_workspace_skill_index';
import { build_skills_discovery_block } from '@runtime-platform/skills/resolve_skills_for_run';
import { empty_skill_index, type SkillIndex } from '@runtime-platform/skills/skill_index_artifact';
import { workspace_layout_for_version } from '@runtime-platform/storage/workspace_layouts';
import { is_browser_available } from '@runtime-platform/tools/browser_harness';
import { find_hidden_runtime_tool_names } from '@runtime-platform/tools/policies/runtime_tool_policy_visibility';
import { create_tool_batch_policy } from '@runtime-platform/tools/policies/tool_batch_policy';
import {
  open_run_background_writes,
  settle_run_background_writes,
} from '@runtime-platform/tools/run_background_writes';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import type {
  RuntimeToolSourceContext,
  RuntimeToolSourceMetadata,
  RuntimeToolSourceType,
} from '@runtime-platform/tools/types';
import { mark_workspace_model_credential_invalid_after_auth_failure } from '@runtime-platform/workspace_model_credential_failure';

const log = create_logger('runtime_orchestrator');

export type StartAgentRunInput = {
  workspace_id: string;
  session_id: string;
  known_session?: { agent_id: string; project_id: string | null };
  read_session?: RuntimeSession;
  read_actor_user?: ActorUser;
  user_message?: string;
  user_content?: RuntimeAgentMessagePart[];
  attachment_sources?: RuntimeAttachmentSource[];
  prior_messages?: StartAgentRunPriorMessage[];
  source_type?: RuntimeToolSourceType;
  user_message_source_metadata?: RuntimeToolSourceMetadata;
  model_provider?: string;
  model_proxy?: string;
  model_name?: string;
  reasoning_level?: RuntimeReasoningLevel;
  temperature?: number;
  max_output_tokens?: number;
  workspace_runtime_provider?: WorkspaceRuntimeProvider;
  workspace_base_path?: string;
  allowed_tool_names?: readonly string[];
  api_key_id?: string;
  run_metadata?: Record<string, unknown>;
  resumed_from_job_id?: string;
  continues_session?: boolean;
  resume_run_id?: string;
  include_connection_context?: boolean;
  include_imported_persona?: boolean;
  user_message_is_user_visible?: boolean;
  runtime_response_is_user_visible?: boolean;
  trigger_type?: Parameters<typeof create_run>[1]['trigger_type'];
  trigger_id?: string;
  automation_id?: string;
  actor_id: string;
};

export type StartAgentRunPriorMessage = {
  message_role: 'user' | 'assistant';
  message_content: RuntimeAgentMessagePart[];
  source_type?: RuntimeToolSourceType;
  source_metadata?: Record<string, unknown>;
  is_user_visible?: boolean;
};

type CreatedRun = Awaited<ReturnType<typeof create_run>>;
type CreatedRunMessage = Awaited<ReturnType<typeof create_run_messages>>[number];
type RuntimeSession = NonNullable<Awaited<ReturnType<typeof get_session>>>;
type ActorUser = NonNullable<Parameters<typeof resolve_chat_speaker>[1]['read_actor_user']> | null;

export type AgentRunStreamEvent =
  | { type: 'run_created'; run: CreatedRun }
  | { type: 'run_updated'; run: CreatedRun }
  | { type: 'message_created'; message: CreatedRunMessage }
  | { type: 'chat_event'; event: ChatStreamEvent }
  | { type: 'runtime_event'; event: RuntimeRunEvent };

export type StartAgentRunOptions = {
  on_stream_event?: (event: AgentRunStreamEvent) => void | Promise<void>;
  stop_signal?: AbortSignal;
  run_hooks?: RunHooks;
};

export type CancelAgentRunInput = {
  workspace_id: string;
  run_id: string;
  actor_id: string;
};

const agent_run_stop_deadline_ms = 15_000;

async function stop_agent_run_before_release(
  run_id: string,
  abort_active_agent_run: (() => void) | undefined,
) {
  if (!abort_active_agent_run) return;

  abort_active_agent_run();
  const stopped = await wait_for_agent_run_to_stop(run_id, agent_run_stop_deadline_ms);
  if (!stopped) {
    log.warn(`run ${run_id} did not stop within 15s of finishing; releasing session anyway`);
  }
}

export async function cancel_agent_run(db: Database, input: CancelAgentRunInput) {
  await request_run_cancellation(db, input.workspace_id, input.run_id, input.actor_id);
  cancel_active_agent_run(input.run_id);
  const stopped = await wait_for_agent_run_to_stop(input.run_id, agent_run_stop_deadline_ms);
  if (!stopped) {
    log.warn(`run ${input.run_id} did not stop within 15s of cancellation; releasing lock anyway`);
  }
  const run = await cancel_run(db, input.workspace_id, input.run_id, input.actor_id);
  await withdraw_run_tool_policy_waits(db, {
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
  });
  await release_session_execution_lock(db, {
    workspace_id: input.workspace_id,
    session_id: run.session_id,
    run_id: input.run_id,
    actor_id: input.actor_id,
    session_status: 'cancelled',
  });
  return run;
}

export async function start_agent_run(
  db: Database,
  input: StartAgentRunInput,
  options: StartAgentRunOptions = {},
) {
  const performance = create_run_performance_tracker();
  const settle_credit_gates = begin_run_start_credit_gates(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    continues_started_run: Boolean(input.resume_run_id),
  });
  const speaker_promise = resolve_chat_speaker(db, {
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    source_metadata: input.user_message_source_metadata,
    ...(input.read_actor_user === undefined ? {} : { read_actor_user: input.read_actor_user }),
  });
  const { session, resumed_run, model_resolution_inputs, room_private_to, run_audience } =
    await read_run_start_records(db, input);
  const participants = build_run_participants(
    session,
    resumed_run?.trigger_type ?? input.trigger_type,
  );

  const [agent, project, project_member_names] = model_resolution_inputs;
  const { resolved_model, model } = resolve_run_model(input, model_resolution_inputs);
  const runs_on_workspace_credential = resolved_model.credential_origin === 'workspace';
  await settle_credit_gates(runs_on_workspace_credential);
  const runtime_model = runtime_model_from_resolved_model(model);
  const run_id = resumed_run?.run_id ?? create_id(id_prefixes.run);
  const close_owner: WorkspaceCloseOwner = {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id,
    actor_id: input.actor_id,
  };
  let user_content = normalize_user_content(input);
  const message_images = create_image_attachment_sources(
    run_id,
    user_content,
    input.attachment_sources ?? [],
  );
  const attachment_sources = create_runtime_attachment_source_map([
    ...(input.attachment_sources ?? []),
    ...message_images.sources,
  ]);
  let user_text = runtime_message_parts_text(user_content);
  let unsaved_inputs = resumed_run ? [] : build_run_input_messages(input, run_id, user_content);
  const runtime_response_is_user_visible = input.runtime_response_is_user_visible ?? true;
  const speaker = await speaker_promise;
  const run_facts = { session, participants, speaker, room_private_to, start: input };
  const run_hooks = open_run_hook_session(db, close_owner, run_facts, options.run_hooks);
  const run_source = { db, ...close_owner, ...run_facts, memory_run: run_hooks.memory_run };
  const pending_memory_prompt_text = start_memory_prompt_text(run_source);
  let workspace_skill_index_promise: Promise<SkillIndex> = Promise.resolve(empty_skill_index);
  let current_connection_context_promise: Promise<SessionCurrentConnectionContext | undefined> =
    Promise.resolve(undefined);
  let workspace_library_promise: Promise<SessionWorkspaceLibraryContext | undefined> =
    Promise.resolve(undefined);
  let billing_context_line_promise: Promise<string | null> = Promise.resolve(null);
  let run: CreatedRun | undefined;
  let lock: SessionLock | undefined;
  let run_finalized = false;
  let runtime_error_recorded = false;
  let coding_workspace: OpenedCodingWorkspace | undefined;
  let unregister_active_agent_run: (() => void) | undefined;
  let cancel_poll_handle: NodeJS.Timeout | undefined;
  let abort_active_agent_run: (() => void) | undefined;
  let read_agent_run_usage: (() => RuntimeRunUsage) | undefined;
  let context_snapshot_write: Promise<unknown> = Promise.resolve();
  let session_title_write: Promise<unknown> = Promise.resolve();
  let session_lock_release_status: 'active' | 'idle' | 'failed' | 'cancelled' | 'completed' =
    'active';
  let stopped_for_lost_claim = false;
  const stop_for_lost_claim = () => {
    stopped_for_lost_claim = true;
    abort_active_agent_run?.();
  };
  options.stop_signal?.addEventListener('abort', stop_for_lost_claim, { once: true });
  const saved_turns = create_saved_tool_call_turns();
  const record_run_spend_once = create_run_spend_recorder(
    {
      db,
      workspace_id: input.workspace_id,
      agent_id: session.agent_id,
      session_id: input.session_id,
      run_id,
      model,
      billing_treatment: runs_on_workspace_credential ? 'byok' : 'billed',
      ...(input.api_key_id ? { api_key_id: input.api_key_id } : {}),
      performance,
      actor_id: input.actor_id,
    },
    () => run !== undefined,
  );

  try {
    lock = await acquire_session_lock(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id,
      actor_id: input.actor_id,
      on_lock_lost: () => {
        session_lock_release_status = 'failed';
        abort_active_agent_run?.();
      },
    });
    const created_run =
      resumed_run ??
      performance.measure_db_write(() =>
        create_run(db, {
          run_id,
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          agent_id: session.agent_id,
          trigger_type: input.trigger_type ?? 'user_message',
          ...(input.trigger_id ? { trigger_id: input.trigger_id } : {}),
          ...(input.automation_id ? { automation_id: input.automation_id } : {}),
          model_provider: model.model_provider,
          model_proxy: model.model_proxy,
          model_name: model.model_name,
          ...(input.run_metadata ? { run_metadata: input.run_metadata } : {}),
          ...(input.resumed_from_job_id ? { resumed_from_job_id: input.resumed_from_job_id } : {}),
          actor_id: input.actor_id,
        }),
      );
    if (input.include_connection_context !== false) {
      current_connection_context_promise = get_current_connection_context(db, {
        workspace_id: input.workspace_id,
        participants,
        room_private_to,
      });
    }
    workspace_library_promise = get_workspace_library_context(run_source);
    workspace_skill_index_promise = read_workspace_skill_index(db, {
      ...input,
      agent_id: session.agent_id,
    });
    billing_context_line_promise = workspace_billing_context_line(db, input.workspace_id);

    run = await created_run;
    const active_run = run;
    const [running_run] = await Promise.all([
      performance.measure_db_write(() => mark_run_running(db, active_run.run_id, input.actor_id)),
      emit_stream_event(options.on_stream_event, { type: 'run_created', run }),
    ]);
    const record_chat_stream_events = create_chat_stream_event_recorder(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: active_run.run_id,
      actor_id: input.actor_id,
    });
    const emit_chat_stream_event_drafts = async (drafts: ChatStreamEventDraft[]) => {
      if (!runtime_response_is_user_visible) return;
      if (drafts.length === 0) return;

      const chat_events = await performance.measure_db_write(() =>
        record_chat_stream_events(drafts),
      );
      for (const chat_event of chat_events) {
        await emit_stream_event(options.on_stream_event, {
          type: 'chat_event',
          event: chat_event,
        });
      }
    };
    if (!resumed_run) {
      session_title_write = set_session_title_from_prompt(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        agent_id: session.agent_id,
        actor_id: input.actor_id,
        prompt_text: user_text,
      });
    }

    await emit_stream_event(options.on_stream_event, { type: 'run_updated', run: running_run });
    const coding_workspace_for_run = await open_or_create_coding_workspace(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      agent_id: session.agent_id,
      run_id: active_run.run_id,
      ...(input.workspace_runtime_provider === undefined
        ? {}
        : { provider: input.workspace_runtime_provider }),
      ...(input.workspace_base_path === undefined
        ? {}
        : { workspace_base_path: input.workspace_base_path }),
      prepare_attached_environment: (workspace) =>
        run_hooks.prepare(workspace, workspace_skill_index_promise),
      actor_id: input.actor_id,
    });
    coding_workspace = coding_workspace_for_run;
    const runtime_environment_update = settle_write(
      performance.measure_db_write(() =>
        update_session_runtime_environment(db, {
          session_id: input.session_id,
          runtime_environment_id: coding_workspace_for_run.runtime_environment_id,
          actor_id: input.actor_id,
        }),
      ),
    );
    const [hydration, message_text_file] = await Promise.allSettled([
      hydrate_run_attachments(coding_workspace_for_run.environment, [
        ...attachment_sources.values(),
        ...create_inline_text_attachment_sources(active_run.run_id, user_content),
      ]),
      write_message_text_file(coding_workspace_for_run.environment, user_text),
    ]);
    if (hydration.status === 'rejected') throw hydration.reason;
    user_content = [
      ...describe_hydrated_attachments(
        coding_workspace_for_run.environment,
        active_run.run_id,
        user_content,
        hydration.value,
      ),
      ...message_images.notes,
    ];
    user_text = runtime_message_parts_text(user_content);
    const message_text_file_note = describe_message_text_file(
      message_text_file.status === 'fulfilled' ? message_text_file.value : undefined,
    );

    const input_messages = resumed_run
      ? []
      : build_run_input_messages(input, active_run.run_id, user_content, message_text_file_note);
    const created_input_messages = await performance.measure_db_write(() =>
      create_run_messages(db, input_messages),
    );
    unsaved_inputs = [];
    const runtime_environment_failure = await runtime_environment_update;
    if (runtime_environment_failure) throw runtime_environment_failure.error;
    for (const message of created_input_messages) {
      await emit_stream_event(options.on_stream_event, { type: 'message_created', message });
    }

    const context_session = await compact_and_refresh_session_before_model(db, {
      workspace_id: input.workspace_id,
      session,
      run_id: active_run.run_id,
      model: runtime_model,
      actor_id: input.actor_id,
      on_stream_event: options.on_stream_event,
    });
    const context_summary_source = context_summary_source_from_session_metadata(
      context_session.session_metadata,
    );
    const [
      current_connection_context,
      workspace_skill_index,
      workspace_library,
      billing_context_line,
      memory_prompt_text,
    ] = await Promise.all([
      current_connection_context_promise,
      workspace_skill_index_promise,
      workspace_library_promise,
      billing_context_line_promise,
      pending_memory_prompt_text.wait_within_budget(),
    ]);
    const current_turn_context = build_model_visible_current_turn_context(input, speaker);
    const workspace_root =
      coding_workspace_for_run.volume && !coding_workspace_for_run.durable_storage_unavailable
        ? model_visible_environment_context(coding_workspace_for_run).model_workspace_root
        : undefined;
    const compile_context = () =>
      build_session_context(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        system_instructions: build_run_system_instructions({
          agent,
          include_imported_persona: input.include_imported_persona !== false,
          durable_storage_unavailable: coding_workspace_for_run.durable_storage_unavailable,
          billing_context_line,
          memory_prompt_text,
        }),
        ...(project
          ? {
              project: {
                project_name: project.project_name,
                project_description: project.project_description,
                project_instructions: project.project_instructions,
                ...(project.personal_for_user_id === null
                  ? { member_names: project_member_names }
                  : {}),
              },
            }
          : {}),
        ...(workspace_root ? { workspace_root, run_audience } : {}),
        ...(coding_workspace_for_run.volume
          ? {
              workspace_layout: workspace_layout_for_version(
                coding_workspace_for_run.volume.workspace_layout_version,
              ),
            }
          : {}),
        ...(workspace_library ? { workspace_library } : {}),
        model: runtime_model,
        skills_discovery: build_skills_discovery_block({
          ...(current_turn_context?.source_type
            ? { source_type: current_turn_context.source_type }
            : {}),
          workspace_skill_index,
        }),
        browser_available: is_browser_available(coding_workspace_for_run.environment),
        ...(input.allowed_tool_names ? { allowed_tool_names: input.allowed_tool_names } : {}),
        context_summary: context_session.context_summary,
        ...(current_turn_context ? { current_turn_context } : {}),
        ...(current_connection_context ? { current_connection_context } : {}),
        ...(context_summary_source === undefined ? {} : { context_summary_source }),
        summarized_until_message_id: context_session.summarized_until_message_id,
      });
    const runtime_tool_source_context = build_runtime_tool_source_context(input);
    const [compiled_context, hidden_tool_names, cancel_intent_before_start] = await Promise.all([
      performance.measure_context_compile(compile_context),
      find_hidden_runtime_tool_names(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        agent_id: session.agent_id,
        actor_id: input.actor_id,
        ...(speaker?.source_actor_id ? { acting_actor_id: speaker.source_actor_id } : {}),
        source_context: runtime_tool_source_context,
        ...(current_connection_context ? { current_connection_context } : {}),
      }),
      read_cancel_intent_before_start(db, { ...input, run_id: active_run.run_id }),
    ]);
    let context = compiled_context;
    const tool_batch_policy = create_tool_batch_policy(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: active_run.run_id,
      agent_id: session.agent_id,
      actor_id: input.actor_id,
      ...(speaker?.source_actor_id ? { acting_actor_id: speaker.source_actor_id } : {}),
      ...(participants ? { participants } : {}),
      ...(input.resumed_from_job_id ? { resumed_from_job_id: input.resumed_from_job_id } : {}),
      room_private_to,
      source_context: runtime_tool_source_context,
      emit_chat_stream_event_drafts,
    });
    const runtime_tools = tools_allowed_on_this_run(
      [
        ...create_runtime_tool_definitions(db, {
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          run_id: active_run.run_id,
          agent_id: session.agent_id,
          runtime_environment_id: coding_workspace.runtime_environment_id,
          environment: coding_workspace.environment,
          attachment_sources,
          participants,
          room_private_to,
          ...(input.allowed_tool_names ? { allowed_tool_names: input.allowed_tool_names } : {}),
          hidden_tool_names,
          actor_id: input.actor_id,
          source_context: runtime_tool_source_context,
          read_approval_grant: tool_batch_policy.read_approval_grant,
          ...(current_connection_context?.snapshot_status === 'available'
            ? {
                connected_app_names: new Set(
                  current_connection_context.connections
                    .filter((connection) => connection.connection_status === 'active')
                    .map((connection) => connection.app_name),
                ),
              }
            : {}),
          ...(speaker ? { speaker } : {}),
          tool_result_is_user_visible: runtime_response_is_user_visible,
          emit_chat_stream_event_drafts,
          after_write_hooks: await run_hooks.after_workspace_write(),
        }),
      ],
      input.allowed_tool_names,
    );
    tool_batch_policy.set_run_tools(runtime_tools);
    if (resumed_run) {
      const finished_calls = await finish_interrupted_tool_turn(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        run_id: active_run.run_id,
        tools: runtime_tools,
        decide_tool_batch: tool_batch_policy.decide,
        environment: coding_workspace.environment,
        signal: options.stop_signal,
        run_audience,
      });
      if (finished_calls > 0) {
        context = await performance.measure_context_compile(compile_context);
      }
    }
    const runtime_messages = context.messages
      .filter((message) => ['user', 'assistant', 'tool_result'].includes(message.role))
      .map((message) => runtime_message_from_context_message(message));
    const agent_run_metadata = {
      workspace_id: input.workspace_id,
      agent_id: session.agent_id,
      context_management: context.context_management,
      run_audience,
    };
    const context_snapshot = create_model_context_snapshot({
      run_key: active_run.run_id,
      session_key: input.session_id,
      system_prompt: context.system_prompt,
      context_summary: context.context_summary,
      context_packets: context.context_packets,
      context_management: context.context_management,
      selection_policy: context.selection_policy,
      model: runtime_model,
      messages: runtime_messages,
      tools: runtime_tools,
      environment_context: model_visible_environment_context(coding_workspace),
      metadata: agent_run_metadata,
    });
    context_snapshot_write = performance.measure_db_write(() =>
      store_run_model_context_snapshot(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        run_id: active_run.run_id,
        snapshot_kind: 'engine_input',
        model_provider: model.model_provider,
        model_name: model.model_name,
        message_count: context_snapshot.message_count,
        tool_count: context_snapshot.tool_count,
        token_estimate: context_snapshot.token_estimate,
        snapshot: context_snapshot.snapshot,
        snapshot_metadata: {
          source: 'runtime_orchestrator',
        },
        actor_id: input.actor_id,
      }),
    );

    const credit_gate = create_mid_run_credit_gate({ db, workspace_id: input.workspace_id });
    const agent_run = create_agent_run({
      run_key: active_run.run_id,
      session_key: input.session_id,
      system_prompt: context.system_prompt,
      model: runtime_model,
      messages: runtime_messages,
      tools: runtime_tools,
      environment: coding_workspace.environment,
      metadata: agent_run_metadata,
      engine: create_agent_engine(),
      decide_tool_batch: async (calls) => {
        await saved_turns.wait_until_saved(calls.map((call) => call.tool_call_id));
        return tool_batch_policy.decide(calls);
      },
      before_turn: run_hooks.before_turn(async (state) => {
        if (!runs_on_workspace_credential) await credit_gate.before_turn(state);
      }),
    });
    unregister_active_agent_run = register_active_agent_run(active_run.run_id, agent_run);
    abort_active_agent_run = () => agent_run.abort();
    if (stopped_for_lost_claim) agent_run.abort();
    read_agent_run_usage = () => agent_run.usage();
    const project_chat_stream_event = create_chat_stream_event_projector();

    const stop_if_cancel_requested = async () => {
      try {
        const intent = await get_run_cancel_intent(db, input.workspace_id, active_run.run_id);
        if (intent?.cancel_requested_time) {
          if (cancel_poll_handle) {
            clearInterval(cancel_poll_handle);
            cancel_poll_handle = undefined;
          }
          agent_run.abort();
        }
      } catch (error) {
        log.warn('Cancel poll failed', { run_id: active_run.run_id, error });
      }
    };
    if (cancel_intent_before_start?.cancel_requested_time) agent_run.abort();
    cancel_poll_handle = setInterval(() => void stop_if_cancel_requested(), 1000);

    let result: AgentRunResult | undefined;
    open_run_background_writes(active_run.run_id);
    performance.start_model_phase();
    for await (const event of agent_run.events()) {
      performance.record_engine_event();
      const persisted_message =
        event.event_type === 'message_delta'
          ? undefined
          : await performance.measure_db_write(() =>
              record_runtime_event(db, {
                workspace_id: input.workspace_id,
                session_id: input.session_id,
                run_id: active_run.run_id,
                event,
                is_user_visible: runtime_response_is_user_visible,
                actor_id: input.actor_id,
              }),
            );

      if (runtime_response_is_user_visible) {
        await emit_chat_stream_event_drafts(
          project_chat_stream_event({
            workspace_id: input.workspace_id,
            session_id: input.session_id,
            run_id: active_run.run_id,
            event,
            ...(persisted_message
              ? { persisted_message_id: persisted_message.run_message_id }
              : {}),
          }),
        );
        await emit_stream_event(options.on_stream_event, { type: 'runtime_event', event });
      }
      if (persisted_message) {
        if (event.event_type === 'message') saved_turns.record_saved_message(event.message);
        await emit_stream_event(options.on_stream_event, {
          type: 'message_created',
          message: persisted_message,
        });
      }

      if (event.event_type === 'error') runtime_error_recorded = true;
      if (event.event_type === 'end') result = event.result;
    }
    performance.finish_model_phase();
    await settle_run_background_writes(active_run.run_id);

    if (!result) throw new Error('Runtime ended without a completion result');

    if (result.status === 'aborted' && stopped_for_lost_claim) {
      await record_run_spend_once({ usage: result.usage });
      run_hooks.close_without_settle(coding_workspace);
      throw new AgentRunStoppedError(active_run.run_id);
    }

    if (result.status === 'aborted') {
      await record_run_spend_once({ usage: result.usage });
      await performance.measure_db_write(() =>
        hide_run_messages_from_model(db, {
          workspace_id: input.workspace_id,
          run_id: active_run.run_id,
          actor_id: input.actor_id,
        }),
      );
      await update_run_performance(
        db,
        input.workspace_id,
        active_run.run_id,
        performance,
        input.actor_id,
      );
      const cancelled_run = await performance.measure_db_write(() =>
        mark_run_cancelled(db, active_run.run_id, input.actor_id),
      );
      await emit_stream_event(options.on_stream_event, { type: 'run_updated', run: cancelled_run });
      run_hooks.close(coding_workspace, 'aborted');
      run_finalized = true;
      session_lock_release_status = 'cancelled';
      return cancelled_run;
    }

    if (result.status !== 'completed') {
      const message = result.error?.message ?? `Runtime ended with status ${result.status}`;
      if (runs_on_workspace_credential) {
        await mark_workspace_model_credential_invalid_after_auth_failure(db, {
          workspace_id: input.workspace_id,
          credential_env_name: resolved_model.credential_env_name,
          error_message: message,
          actor_id: input.actor_id,
        });
      }
      await record_run_spend_once({ usage: result.usage });
      await performance.measure_db_write(() =>
        hide_run_messages_from_model(db, {
          workspace_id: input.workspace_id,
          run_id: active_run.run_id,
          actor_id: input.actor_id,
        }),
      );
      await update_run_performance(
        db,
        input.workspace_id,
        active_run.run_id,
        performance,
        input.actor_id,
      );
      const failed_run = await performance.measure_db_write(() =>
        mark_run_failed(db, active_run.run_id, input.actor_id, message, result.error?.code),
      );
      await emit_stream_event(options.on_stream_event, { type: 'run_updated', run: failed_run });
      run_finalized = true;
      if (failed_run.run_status === 'cancelled') {
        session_lock_release_status = 'cancelled';
        run_hooks.close(coding_workspace, 'aborted');
        return failed_run;
      }
      await run_hooks.fail(coding_workspace, message);
      session_lock_release_status = 'failed';
      throw credit_gate.stop_error() ?? new Error(message);
    }

    const assistant_text = runtime_message_text(result.final_message);
    await record_run_spend_once({
      usage: result.usage,
      estimated_tokens: Math.ceil((user_text.length + assistant_text.length) / 4),
    });

    await update_run_performance(
      db,
      input.workspace_id,
      active_run.run_id,
      performance,
      input.actor_id,
    );
    const waiting_run = await performance.measure_db_write(() =>
      mark_run_waiting(db, {
        workspace_id: input.workspace_id,
        run_id: active_run.run_id,
        actor_id: input.actor_id,
      }),
    );
    if (waiting_run) {
      await performance.measure_db_write(() =>
        mark_run_completion_waiting(db, {
          workspace_id: input.workspace_id,
          run_id: active_run.run_id,
          actor_id: input.actor_id,
        }),
      );
      await update_run_performance(
        db,
        input.workspace_id,
        active_run.run_id,
        performance,
        input.actor_id,
      );
      run_hooks.close(coding_workspace, 'waiting');
      await emit_stream_event(options.on_stream_event, { type: 'run_updated', run: waiting_run });
      run_finalized = true;
      session_lock_release_status = 'completed';
      return waiting_run;
    }

    const completed_run = await performance.measure_db_write(() =>
      mark_run_completed(db, active_run.run_id, input.actor_id),
    );
    const run_was_cancelled = completed_run.run_status === 'cancelled';
    run_hooks.close(coding_workspace, run_was_cancelled ? 'aborted' : 'completed', (workspace) =>
      finish_workspace_before_close(db, workspace, {
        actor_id: input.actor_id,
        recompile_skill_index: !run_was_cancelled,
      }),
    );
    await emit_stream_event(options.on_stream_event, { type: 'run_updated', run: completed_run });
    run_finalized = true;
    void start_background_session_compaction(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: active_run.run_id,
      model: runtime_model,
      actor_id: input.actor_id,
    });
    if (run_was_cancelled) {
      session_lock_release_status = 'cancelled';
      return completed_run;
    }
    session_lock_release_status = 'completed';
    return completed_run;
  } catch (error) {
    if (stopped_for_lost_claim) throw run ? new AgentRunStoppedError(run.run_id) : error;
    const message = describe_error_with_cause(error);
    const database_error_code = find_database_error_details(error)?.code;
    session_lock_release_status = 'failed';
    if (!run) throw error;
    const failed_run_record = run;
    await settle_run_background_writes(failed_run_record.run_id);

    await record_run_spend_once({ usage: read_agent_run_usage?.() ?? empty_run_usage() });

    await performance.measure_db_write(() =>
      hide_run_messages_from_model(db, {
        workspace_id: input.workspace_id,
        run_id: failed_run_record.run_id,
        actor_id: input.actor_id,
      }),
    );
    if (!runtime_error_recorded && !run_finalized) {
      await performance.measure_db_write(() =>
        record_runtime_error_event(db, {
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          run_id: failed_run_record.run_id,
          message,
          sandbox_started: coding_workspace !== undefined,
          unsaved_input_messages: unsaved_inputs,
          actor_id: input.actor_id,
        }),
      );
    }

    if (!run_finalized) {
      await update_run_performance(
        db,
        input.workspace_id,
        failed_run_record.run_id,
        performance,
        input.actor_id,
      );
      const failed_run = await performance.measure_db_write(() =>
        mark_run_failed(db, failed_run_record.run_id, input.actor_id, message, database_error_code),
      );
      await emit_stream_event(options.on_stream_event, { type: 'run_updated', run: failed_run });
      await run_hooks.fail(coding_workspace, message);
      if (failed_run.run_status === 'cancelled') {
        session_lock_release_status = 'cancelled';
        return failed_run;
      }
    }
    throw error;
  } finally {
    options.stop_signal?.removeEventListener('abort', stop_for_lost_claim);
    saved_turns.stop(new Error(`Run ${run_id} ended before its turn was saved.`));
    if (cancel_poll_handle) clearInterval(cancel_poll_handle);
    await stop_agent_run_before_release(run_id, abort_active_agent_run);
    unregister_active_agent_run?.();
    await session_title_write;
    await context_snapshot_write.catch((error) =>
      log.warn('Snapshot write failed', { run_id, error }),
    );
    if (stopped_for_lost_claim) lock?.stop_renewing();
    else await lock?.release(session_lock_release_status);
  }
}

async function compact_and_refresh_session_before_model(
  db: Database,
  input: {
    workspace_id: string;
    session: RuntimeSession;
    run_id: string;
    model: ReturnType<typeof runtime_model_from_resolved_model>;
    actor_id: string;
    on_stream_event?: StartAgentRunOptions['on_stream_event'];
  },
): Promise<RuntimeSession> {
  const outcome = await maybe_compact_session_context(db, {
    workspace_id: input.workspace_id,
    session_id: input.session.session_id,
    run_id: input.run_id,
    context_summary: input.session.context_summary,
    summarized_until_message_id: input.session.summarized_until_message_id,
    model: input.model,
    actor_id: input.actor_id,
    tier: 'hard',
  });
  await stream_compaction_event(outcome, input.on_stream_event);
  if (outcome.status !== 'compacted' && outcome.status !== 'superseded') return input.session;

  return (await get_session(db, input.workspace_id, input.session.session_id)) ?? input.session;
}

async function stream_compaction_event(
  outcome: Awaited<ReturnType<typeof maybe_compact_session_context>>,
  on_stream_event: StartAgentRunOptions['on_stream_event'],
) {
  if (outcome.status !== 'compacted' || !outcome.event) return;
  await emit_stream_event(on_stream_event, { type: 'runtime_event', event: outcome.event });
}

async function emit_stream_event(
  on_stream_event: StartAgentRunOptions['on_stream_event'],
  event: AgentRunStreamEvent,
) {
  try {
    await on_stream_event?.(event);
  } catch (error) {
    log.warn('stream observer skipped:', error instanceof Error ? error.message : error);
  }
}

async function update_run_performance(
  db: Database,
  workspace_id: string,
  run_id: string,
  performance: ReturnType<typeof create_run_performance_tracker>,
  actor_id: string,
) {
  const tool_calls = await list_run_tool_calls(db, workspace_id, run_id);
  performance.set_tool_total_ms(
    tool_calls.reduce((total, tool_call) => total + (tool_call.duration_ms ?? 0), 0),
  );
  await performance.measure_db_write(() =>
    update_run_performance_metrics(db, {
      run_id,
      ...performance.snapshot(),
      actor_id,
    }),
  );
}

function model_visible_environment_context(coding_workspace: OpenedCodingWorkspace) {
  const metadata = coding_workspace.environment.metadata ?? {};
  return {
    runtime_environment_id: coding_workspace.runtime_environment_id,
    environment_provider: coding_workspace.provider,
    environment_kind: coding_workspace.environment.env_kind,
    workspace_mount_key: coding_workspace.workspace_mount_key,
    working_directory: coding_workspace.environment.working_directory,
    model_workspace_root:
      typeof metadata.model_workspace_root === 'string' ? metadata.model_workspace_root : '/work',
    model_working_directory:
      typeof metadata.model_working_directory === 'string'
        ? metadata.model_working_directory
        : coding_workspace.environment.working_directory,
    ...(coding_workspace.volume
      ? {
          workspace_index: '/work/WORKSPACE.md',
          reusable_code_directory: '/work/clients',
        }
      : {}),
  };
}

function build_runtime_tool_source_context(input: StartAgentRunInput): RuntimeToolSourceContext {
  return {
    source_type: input.source_type ?? 'dashboard',
    ...(input.user_message_source_metadata === undefined
      ? {}
      : { source_metadata: input.user_message_source_metadata }),
  };
}

function tools_allowed_on_this_run(
  tools: AgentRuntimeToolDefinition[],
  allowed_tool_names: readonly string[] | undefined,
): AgentRuntimeToolDefinition[] {
  if (!allowed_tool_names) return tools;
  const allowed = new Set(allowed_tool_names);
  return tools.filter((tool) => allowed.has(tool.tool_name));
}

function context_summary_source_from_session_metadata(
  session_metadata: unknown,
): SessionContextManagement['summary_source'] | undefined {
  if (!session_metadata || typeof session_metadata !== 'object') return undefined;

  const context_summary = (session_metadata as Record<string, unknown>).context_summary;
  if (!context_summary || typeof context_summary !== 'object') return undefined;

  const source = (context_summary as Record<string, unknown>).source;
  return source === 'pi_agent_harness_compaction' ? 'pi_agent_harness.compaction' : undefined;
}

function runtime_message_from_context_message(message: {
  role: string;
  content: MessageContent;
}): RuntimeAgentMessage {
  if (message.role === 'assistant') {
    return { role: 'assistant', content: message_content_to_runtime_parts(message.content) };
  }

  if (message.role === 'tool_result') {
    return { role: 'tool', content: message_content_to_runtime_parts(message.content) };
  }

  return { role: 'user', content: message_content_to_runtime_parts(message.content) };
}

function runtime_message_text(message?: RuntimeAgentMessage) {
  return (
    message?.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim() ?? ''
  );
}

export function normalize_user_content(input: StartAgentRunInput): RuntimeAgentMessagePart[] {
  if (input.user_content && input.user_content.length > 0) return input.user_content;
  const text = input.user_message?.trim();
  if (text) return [{ type: 'text', text }];
  if (input.continues_session || input.resume_run_id) return [];
  throw new Error('User message content is required');
}
