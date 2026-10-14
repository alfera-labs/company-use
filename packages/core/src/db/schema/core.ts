import { lifecycle_columns, metadata } from '@coworker/core/db/schema/common';
import type {
  AgentConfigData,
  AppConfigData,
  AppDisplayConfigData,
  AppMetadataData,
  ApprovalPolicyData,
  ChannelConfigData,
  ConnectionConfigData,
  ConnectionCredentialData,
  ConnectionMetadataData,
  ConnectionSetupStateData,
  EvalReportMetadataData,
  EventBodyData,
  EventJobErrorData,
  EventJobMetadataData,
  EventJobResultData,
  EventRawPayloadData,
  FileMetadataData,
  NodeConfigData,
  NodeInputSchemaData,
  NodeMetadataData,
  ProviderAccountData,
  RunMessageContentData,
  RunMetadataData,
  SessionMetadata,
  SessionSourceMetadataData,
  SlackSourceMetadataData,
  ToolInputData,
  TriggerConfigData,
  TriggerSourceData,
  UserData,
  VolumeConfigData,
  WorkspaceData,
} from '@coworker/core/db/schema/json_column_types';
import type { RuntimeEnvironmentData } from '@coworker/core/db/schema/runtime_environment_data';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export type {
  RuntimeEnvironmentData,
  RuntimeEnvironmentExplicitPreview,
  RuntimeEnvironmentPreview,
} from '@coworker/core/db/schema/runtime_environment_data';

export const users = pgTable(
  'users',
  {
    user_id: text('user_id')
      .primaryKey()
      .default(sql`'user_' || nextval('user_id_sequence')::text`),
    email: text('email').notNull(),
    first_name: text('first_name'),
    last_name: text('last_name'),
    avatar_url: text('avatar_url'),
    external_identity_provider: text('external_identity_provider'),
    external_identity_id: text('external_identity_id'),
    user_status: text('user_status').notNull().default('active'),
    user_data: jsonb('user_data').$type<UserData>().notNull().default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_users_email_unique').on(table.email),
    uniqueIndex('idx_users_external_identity_unique')
      .on(table.external_identity_provider, table.external_identity_id)
      .where(
        sql`${table.external_identity_provider} IS NOT NULL AND ${table.external_identity_id} IS NOT NULL`,
      ),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    workspace_id: text('workspace_id')
      .primaryKey()
      .default(sql`'ws_' || nextval('workspace_id_sequence')::text`),
    workspace_name: text('workspace_name').notNull(),
    workspace_slug: text('workspace_slug').notNull(),
    external_identity_provider: text('external_identity_provider'),
    external_identity_id: text('external_identity_id'),
    workspace_status: text('workspace_status').notNull().default('active'),
    workspace_data: jsonb('workspace_data')
      .$type<WorkspaceData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    stripe_customer_id: text('stripe_customer_id'),
    inbound_email_username: text('inbound_email_username'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_workspaces_slug_unique').on(table.workspace_slug),
    uniqueIndex('idx_workspaces_inbound_email_username_unique')
      .on(table.inbound_email_username)
      .where(sql`${table.inbound_email_username} IS NOT NULL`),
    check(
      'chk_workspaces_inbound_email_username_lowercase',
      sql`${table.inbound_email_username} = lower(${table.inbound_email_username})`,
    ),
    uniqueIndex('idx_workspaces_external_identity_unique')
      .on(table.external_identity_provider, table.external_identity_id)
      .where(
        sql`${table.external_identity_provider} IS NOT NULL AND ${table.external_identity_id} IS NOT NULL`,
      ),
  ],
);

export const workspace_members = pgTable(
  'workspace_members',
  {
    workspace_member_id: text('workspace_member_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    user_id: text('user_id').notNull(),
    member_role: text('member_role').notNull().default('owner'),
    member_status: text('member_status').notNull().default('active'),
    external_identity_provider: text('external_identity_provider'),
    external_identity_id: text('external_identity_id'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_workspace_members_workspace_user_unique').on(
      table.workspace_id,
      table.user_id,
    ),
    uniqueIndex('idx_workspace_members_external_identity_unique')
      .on(table.external_identity_provider, table.external_identity_id)
      .where(
        sql`${table.external_identity_provider} IS NOT NULL AND ${table.external_identity_id} IS NOT NULL`,
      ),
    index('idx_workspace_members_user').on(table.user_id),
  ],
);

export const agents = pgTable(
  'agents',
  {
    agent_id: text('agent_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_slug: text('agent_slug').notNull().default('main'),
    agent_name: text('agent_name').notNull(),
    agent_description: text('agent_description'),
    agent_status: text('agent_status').notNull().default('active'),
    agent_kind: text('agent_kind').notNull().default('main'),
    system_prompt: text('system_prompt').notNull().default(''),
    default_model: text('default_model'),
    default_model_provider: text('default_model_provider'),
    default_model_name: text('default_model_name'),
    agent_config: jsonb('agent_config')
      .$type<AgentConfigData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_agents_workspace').on(table.workspace_id),
    uniqueIndex('idx_agents_workspace_slug_unique').on(table.workspace_id, table.agent_slug),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    session_id: text('session_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_id: text('agent_id').notNull(),
    project_id: text('project_id'),
    session_title: text('session_title'),
    session_status: text('session_status').notNull().default('active'),
    source_type: text('source_type').notNull().default('dashboard'),
    session_source: text('session_source').notNull().default('dashboard'),
    external_thread_key: text('external_thread_key'),
    context_summary: text('context_summary'),
    summarized_until_message_id: text('summarized_until_message_id'),
    active_leaf_entry_id: text('active_leaf_entry_id'),
    active_run_id: text('active_run_id'),
    locked_by_run_id: text('locked_by_run_id'),
    lock_expires_time: timestamp('lock_expires_time', { withTimezone: true }),
    runtime_environment_id: text('runtime_environment_id'),
    last_message_time: timestamp('last_message_time', { withTimezone: true }),
    last_message_preview: text('last_message_preview'),
    source_metadata: jsonb('source_metadata')
      .$type<SessionSourceMetadataData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    session_metadata: jsonb('session_metadata')
      .$type<SessionMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_sessions_workspace_updated').on(table.workspace_id, table.last_updated_time),
    index('idx_sessions_project')
      .on(table.workspace_id, table.project_id)
      .where(sql`${table.project_id} IS NOT NULL`),
    index('idx_sessions_agent').on(table.agent_id),
    index('idx_sessions_status_updated').on(
      table.workspace_id,
      table.session_status,
      table.last_updated_time,
    ),
    index('idx_sessions_locked_by_run').on(table.locked_by_run_id),
    index('idx_sessions_active_leaf').on(table.workspace_id, table.active_leaf_entry_id),
    uniqueIndex('idx_sessions_external_thread_unique')
      .on(table.workspace_id, table.agent_id, table.session_source, table.external_thread_key)
      .where(sql`${table.external_thread_key} IS NOT NULL`),
  ],
);

export const session_tree_entries = pgTable(
  'session_tree_entries',
  {
    session_tree_entry_id: text('session_tree_entry_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    parent_entry_id: text('parent_entry_id'),
    entry_type: text('entry_type').notNull(),
    entry_sequence: integer('entry_sequence').notNull(),
    entry_data: jsonb('entry_data').notNull(),
    source_run_id: text('source_run_id'),
    source_run_message_id: text('source_run_message_id'),
    actor_id: text('actor_id'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_session_tree_entries_session_sequence_unique').on(
      table.session_id,
      table.entry_sequence,
    ),
    index('idx_session_tree_entries_session_time').on(
      table.workspace_id,
      table.session_id,
      table.created_time,
    ),
    index('idx_session_tree_entries_parent').on(
      table.workspace_id,
      table.session_id,
      table.parent_entry_id,
    ),
    index('idx_session_tree_entries_source_message').on(table.source_run_message_id),
  ],
);

export const session_context_operations = pgTable(
  'session_context_operations',
  {
    session_context_operation_id: text('session_context_operation_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    run_id: text('run_id'),
    operation_type: text('operation_type').notNull(),
    operation_sequence: integer('operation_sequence').notNull(),
    target_entry_ids: jsonb('target_entry_ids').notNull().default(sql`'[]'::jsonb`),
    operation_data: jsonb('operation_data').notNull(),
    operation_reason: text('operation_reason'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_session_context_operations_session_sequence_unique').on(
      table.session_id,
      table.operation_sequence,
    ),
    index('idx_session_context_operations_session_time').on(
      table.workspace_id,
      table.session_id,
      table.created_time,
    ),
    index('idx_session_context_operations_run').on(table.run_id),
  ],
);

export const runs = pgTable(
  'runs',
  {
    run_id: text('run_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    agent_id: text('agent_id').notNull(),
    trigger_id: text('trigger_id'),
    automation_id: text('automation_id'),
    parent_run_id: text('parent_run_id'),
    root_run_id: text('root_run_id'),
    resumed_from_job_id: text('resumed_from_job_id'),
    waiting_on_job_id: text('waiting_on_job_id'),
    run_status: text('run_status').notNull().default('queued'),
    trigger_type: text('trigger_type').notNull().default('user_message'),
    run_reason: text('run_reason').notNull().default('user_message'),
    model_provider: text('model_provider'),
    provider_name: text('provider_name'),
    model_name: text('model_name'),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
    cache_write_tokens: integer('cache_write_tokens').notNull().default(0),
    cost_microcents: bigint('cost_microcents', { mode: 'number' }).notNull().default(0),
    cost_microcents_estimate: bigint('cost_microcents_estimate', { mode: 'number' })
      .notNull()
      .default(0),
    context_compile_ms: integer('context_compile_ms').notNull().default(0),
    engine_first_event_ms: integer('engine_first_event_ms').notNull().default(0),
    model_total_ms: integer('model_total_ms').notNull().default(0),
    tool_total_ms: integer('tool_total_ms').notNull().default(0),
    db_write_total_ms: integer('db_write_total_ms').notNull().default(0),
    total_run_ms: integer('total_run_ms').notNull().default(0),
    started_time: timestamp('started_time', { withTimezone: true }),
    completed_time: timestamp('completed_time', { withTimezone: true }),
    finished_time: timestamp('finished_time', { withTimezone: true }),
    cancel_requested_time: timestamp('cancel_requested_time', { withTimezone: true }),
    cancel_requested_by: text('cancel_requested_by'),
    duration_ms: integer('duration_ms'),
    error_code: text('error_code'),
    error_message: text('error_message'),
    usage_metadata: jsonb('usage_metadata').notNull().default(sql`'{}'::jsonb`),
    run_metadata: jsonb('run_metadata')
      .$type<RunMetadataData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_runs_session_created').on(table.session_id, table.created_time),
    index('idx_runs_status').on(table.run_status),
    index('idx_runs_workspace_status_created').on(
      table.workspace_id,
      table.run_status,
      table.created_time,
    ),
    index('idx_runs_root').on(table.workspace_id, table.root_run_id),
    index('idx_runs_automation_time')
      .on(table.workspace_id, table.automation_id, table.created_time.desc())
      .where(sql`${table.automation_id} IS NOT NULL`),
    uniqueIndex('idx_runs_resumed_from_job_unique')
      .on(table.workspace_id, table.resumed_from_job_id)
      .where(sql`${table.resumed_from_job_id} IS NOT NULL`),
    index('idx_runs_waiting')
      .on(table.workspace_id, table.last_updated_time)
      .where(sql`${table.run_status} = 'waiting'`),
  ],
);

export const run_messages = pgTable(
  'run_messages',
  {
    run_message_id: text('run_message_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    run_id: text('run_id').notNull(),
    message_role: text('message_role').notNull(),
    message_kind: text('message_kind').notNull().default('status'),
    message_content: jsonb('message_content').$type<RunMessageContentData>().notNull(),
    content_text: text('content_text'),
    content_json: jsonb('content_json'),
    tool_call_id: text('tool_call_id'),
    provider_item_id: text('provider_item_id'),
    provider_call_id: text('provider_call_id'),
    token_count: integer('token_count'),
    is_model_visible: boolean('is_model_visible').notNull().default(true),
    is_user_visible: boolean('is_user_visible').notNull().default(true),
    source_type: text('source_type').notNull().default('runtime'),
    source_metadata: jsonb('source_metadata')
      .$type<SlackSourceMetadataData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    message_sequence: integer('message_sequence').notNull(),
    run_message_sequence: integer('run_message_sequence').notNull(),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_run_messages_session_sequence_unique').on(
      table.session_id,
      table.message_sequence,
    ),
    uniqueIndex('idx_run_messages_run_sequence_unique').on(
      table.run_id,
      table.run_message_sequence,
    ),
    index('idx_run_messages_run').on(table.run_id),
    index('idx_run_messages_workspace_created').on(table.workspace_id, table.created_time),
  ],
);

export const run_events = pgTable(
  'run_events',
  {
    run_event_id: text('run_event_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    run_id: text('run_id').notNull(),
    tool_call_id: text('tool_call_id'),
    event_sequence: integer('event_sequence').notNull(),
    event_type: text('event_type').notNull(),
    event_label: text('event_label'),
    event_data: jsonb('event_data').notNull().default(sql`'{}'::jsonb`),
    event_metadata: jsonb('event_metadata').notNull().default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_run_events_run_sequence_unique').on(table.run_id, table.event_sequence),
    index('idx_run_events_run').on(table.run_id),
    index('idx_run_events_tool_call').on(table.tool_call_id),
    index('idx_run_events_workspace_created').on(table.workspace_id, table.created_time),
  ],
);

export const events = pgTable(
  'events',
  {
    event_id: text('event_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    source: text('source').notNull(),
    source_event_id: text('source_event_id').notNull(),
    event_type: text('event_type').notNull(),
    queue_key: text('subject_key').notNull(),
    actor_key: text('actor_key').notNull(),
    event_body: jsonb('event_body').$type<EventBodyData>().notNull().default(sql`'{}'::jsonb`),
    raw_payload: jsonb('raw_payload')
      .$type<EventRawPayloadData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    event_status: text('event_status').notNull().default('accepted'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_events_source_unique').on(
      table.workspace_id,
      table.source,
      table.source_event_id,
    ),
    index('idx_events_subject_time').on(table.workspace_id, table.queue_key, table.created_time),
    index('idx_events_status_time').on(table.workspace_id, table.event_status, table.created_time),
    index('idx_events_type_time').on(table.workspace_id, table.event_type, table.created_time),
  ],
);

export const event_jobs = pgTable(
  'event_jobs',
  {
    job_id: text('job_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    event_id: text('event_id'),
    queue_key: text('subject_key').notNull(),
    job_handler: text('job_handler').notNull(),
    job_status: text('job_status').notNull().default('queued'),
    awaits_event_type: text('awaits_event_type'),
    awaits_queue_key: text('awaits_subject_key'),
    awaits_until_time: timestamp('awaits_until_time', { withTimezone: true }),
    available_time: timestamp('available_time', { withTimezone: true }).notNull().defaultNow(),
    locked_by: text('locked_by'),
    locked_until: timestamp('locked_until', { withTimezone: true }),
    lock_token: uuid('lock_token'),
    wake_sent_time: timestamp('wake_sent_time', { withTimezone: true }),
    attempt_count: integer('attempt_count').notNull().default(0),
    interruption_count: integer('interruption_count').notNull().default(0),
    run_id: text('run_id'),
    result_data: jsonb('result_data')
      .$type<EventJobResultData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error_data: jsonb('error_data').$type<EventJobErrorData>().notNull().default(sql`'{}'::jsonb`),
    metadata: metadata<EventJobMetadataData>(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_event_jobs_ready').on(
      table.workspace_id,
      table.job_status,
      table.available_time,
      table.queue_key,
    ),
    index('idx_event_jobs_global_ready')
      .on(
        table.available_time,
        table.created_time,
        table.job_id,
        table.workspace_id,
        table.queue_key,
      )
      .where(sql`${table.job_status} = 'queued'`),
    index('idx_event_jobs_expired_lock')
      .on(table.locked_until, table.job_id)
      .where(sql`${table.job_status} = 'running'`),
    index('idx_event_jobs_subject_status').on(
      table.workspace_id,
      table.queue_key,
      table.job_status,
    ),
    index('idx_event_jobs_unacknowledged_wake')
      .on(table.wake_sent_time)
      .where(sql`${table.job_status} = 'queued'`),
    index('idx_event_jobs_run').on(table.workspace_id, table.run_id),
    uniqueIndex('idx_event_jobs_open_question_unique')
      .on(table.workspace_id, table.awaits_event_type, table.awaits_queue_key)
      .where(
        sql`${table.job_status} = 'waiting' and ${table.job_handler} = 'policy_decision_resume'`,
      ),
    index('idx_event_jobs_awaits_expiry')
      .on(table.awaits_until_time)
      .where(sql`${table.job_status} = 'waiting'`),
  ],
);

export const run_model_context_snapshots = pgTable(
  'run_model_context_snapshots',
  {
    run_model_context_snapshot_id: text('run_model_context_snapshot_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    run_id: text('run_id').notNull(),
    snapshot_kind: text('snapshot_kind').notNull(),
    snapshot_sequence: integer('snapshot_sequence').notNull().default(1),
    model_provider: text('model_provider'),
    model_name: text('model_name'),
    message_count: integer('message_count').notNull().default(0),
    tool_count: integer('tool_count').notNull().default(0),
    token_estimate: integer('token_estimate').notNull().default(0),
    snapshot: jsonb('snapshot').notNull(),
    snapshot_metadata: jsonb('snapshot_metadata').notNull().default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_run_model_context_snapshots_run_kind_sequence_unique').on(
      table.run_id,
      table.snapshot_kind,
      table.snapshot_sequence,
    ),
    index('idx_run_model_context_snapshots_run').on(table.run_id),
    index('idx_run_model_context_snapshots_workspace_created').on(
      table.workspace_id,
      table.created_time,
    ),
  ],
);

export const tool_calls = pgTable(
  'tool_calls',
  {
    tool_call_id: text('tool_call_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    run_id: text('run_id').notNull(),
    agent_id: text('agent_id').notNull().default(''),
    node_id: text('node_id'),
    connection_id: text('connection_id'),
    tool_name: text('tool_name').notNull(),
    node_version: integer('node_version'),
    tool_status: text('tool_status').notNull().default('pending'),
    risk_class: text('risk_class'),
    approval_mode: text('approval_mode'),
    input_data: jsonb('input_data').$type<ToolInputData>().notNull().default(sql`'{}'::jsonb`),
    output_data: jsonb('output_data'),
    output_text: text('output_text'),
    output_file_id: text('output_artifact_id'),
    error_code: text('error_code'),
    error_message: text('error_message'),
    duration_ms: integer('duration_ms'),
    tool_call_metadata: jsonb('tool_call_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    idempotency_key: text('idempotency_key'),
    metadata: metadata(),
    started_time: timestamp('started_time', { withTimezone: true }),
    completed_time: timestamp('completed_time', { withTimezone: true }),
    finished_time: timestamp('finished_time', { withTimezone: true }),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_tool_calls_run').on(table.run_id),
    index('idx_tool_calls_tool_status').on(table.tool_name, table.tool_status),
    index('idx_tool_calls_workspace_tool_created').on(
      table.workspace_id,
      table.tool_name,
      table.created_time,
    ),
    index('idx_tool_calls_workspace_status_created').on(
      table.workspace_id,
      table.tool_status,
      table.created_time,
    ),
    uniqueIndex('idx_tool_calls_idempotency_key_unique')
      .on(table.workspace_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
  ],
);

export const approval_requests = pgTable(
  'approval_requests',
  {
    approval_request_id: text('approval_request_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    run_id: text('run_id').notNull(),
    tool_call_id: text('tool_call_id').notNull(),
    approval_status: text('approval_status').notNull().default('pending'),
    approval_reason: text('approval_reason'),
    requested_action: text('requested_action').notNull(),
    request_data: jsonb('request_data').notNull().default(sql`'{}'::jsonb`),
    requested_by: text('requested_by'),
    requested_time: timestamp('requested_time', { withTimezone: true }).notNull().defaultNow(),
    expires_time: timestamp('expires_time', { withTimezone: true }),
    approval_metadata: jsonb('approval_metadata').notNull().default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_approval_requests_tool_call').on(table.tool_call_id),
    index('idx_approval_requests_run').on(table.run_id),
    index('idx_approval_requests_workspace_status_created').on(
      table.workspace_id,
      table.approval_status,
      table.created_time,
    ),
  ],
);

export const approval_decisions = pgTable(
  'approval_decisions',
  {
    approval_decision_id: text('approval_decision_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    session_id: text('session_id').notNull(),
    run_id: text('run_id').notNull(),
    approval_request_id: text('approval_request_id').notNull(),
    tool_call_id: text('tool_call_id').notNull(),
    decision_status: text('decision_status').notNull(),
    decision_reason: text('decision_reason'),
    decision_data: jsonb('decision_data').notNull().default(sql`'{}'::jsonb`),
    decided_by: text('decided_by').notNull(),
    decided_time: timestamp('decided_time', { withTimezone: true }).notNull().defaultNow(),
    decision_metadata: jsonb('decision_metadata').notNull().default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_approval_decisions_request').on(table.approval_request_id),
    index('idx_approval_decisions_tool_call').on(table.tool_call_id),
    index('idx_approval_decisions_run').on(table.run_id),
  ],
);

// The platform's byte catalogue: both what a person uploaded and what the agent produced.
//
// The TypeScript names say `file`; the DATABASE columns still say `artifact`. That is
// deliberate, not leftover. The API (Cloud Run) and dashboard (Vercel) deploy separately,
// and .github/workflows/deploy-api.yml FAILS the deploy unless migrations ran first — so
// the previous revision necessarily serves traffic against the new schema for the length of
// an image build and rollout. A physical rename would 42703 every read on that revision
// (drizzle expands findMany into an explicit column list), including every tool_calls read,
// with no rollback short of hand-written SQL.
//
// Mapping the names here gets the whole rename with none of that: one deploy, no window,
// and `git revert` is a complete rollback. Renaming the columns is a separate, independently
// deployable migration once this code is live everywhere — see
// migrations/rollback/0048_0049_rename_files_to_artifacts.sql for the shape it takes.
export const files = pgTable(
  'artifacts',
  {
    file_id: text('artifact_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    project_id: text('project_id'),
    session_id: text('session_id'),
    run_id: text('run_id'),
    runtime_environment_id: text('runtime_environment_id'),
    source_tool_call_id: text('source_tool_call_id'),
    file_purpose: text('artifact_kind').notNull(),
    file_status: text('artifact_status').notNull().default('ready'),
    file_direction: text('artifact_direction').notNull().default('outbound'),
    storage_provider: text('storage_provider').notNull(),
    storage_key: text('storage_key').notNull(),
    workspace_path: text('workspace_path'),
    file_name: text('file_name'),
    mime_type: text('mime_type'),
    byte_size: integer('byte_size'),
    checksum_sha256: text('checksum_sha256'),
    content_preview: text('content_preview'),
    is_visible: boolean('is_visible').notNull().default(true),
    file_metadata: jsonb('artifact_metadata')
      .$type<FileMetadataData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_artifacts_run').on(table.run_id),
    index('idx_artifacts_source_tool_call').on(table.source_tool_call_id),
    index('idx_artifacts_workspace_created').on(table.workspace_id, table.created_time),
    index('idx_artifacts_pending_created')
      .on(table.created_time)
      .where(sql`${table.file_status} = 'pending'`),
    index('idx_artifacts_local_workspace_environment')
      .on(table.runtime_environment_id)
      .where(sql`${table.storage_provider} = 'local_workspace'`),
    index('idx_artifacts_workspace_session_created').on(
      table.workspace_id,
      table.session_id,
      table.created_time,
    ),
    index('idx_artifacts_project')
      .on(table.workspace_id, table.project_id)
      .where(sql`${table.project_id} IS NOT NULL`),
  ],
);

export const eval_reports = pgTable(
  'eval_reports',
  {
    eval_report_id: text('eval_report_id').primaryKey(),
    suite_name: text('suite_name').notNull(),
    task_source: text('task_source').notNull(),
    task_id: text('task_id').notNull(),
    run_id: text('run_id').notNull(),
    runtime_environment_id: text('runtime_environment_id'),
    harness_name: text('harness_name').notNull().default('coworker'),
    harness_version: text('harness_version').notNull(),
    runtime_version: text('runtime_version').notNull(),
    model_id: text('model_id').notNull(),
    status: text('status').notNull(),
    failure_reason: text('failure_reason'),
    duration_ms: integer('duration_ms').notNull().default(0),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
    cost_microcents: bigint('cost_microcents', { mode: 'number' }).notNull().default(0),
    tool_call_count: integer('tool_call_count').notNull().default(0),
    trace_pointer: text('trace_pointer').notNull(),
    metadata: metadata<EvalReportMetadataData>(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_eval_reports_suite_runtime_created').on(
      table.suite_name,
      table.runtime_version,
      table.created_time,
    ),
    index('idx_eval_reports_task_created').on(table.task_id, table.created_time),
    index('idx_eval_reports_failure_created').on(table.failure_reason, table.created_time),
    index('idx_eval_reports_run').on(table.run_id),
    uniqueIndex('idx_eval_reports_suite_task_run_unique').on(
      table.suite_name,
      table.task_id,
      table.run_id,
    ),
  ],
);

export const apps = pgTable(
  'apps',
  {
    app_id: text('app_id').primaryKey(),
    app_name: text('app_name').notNull(),
    app_key: text('app_key').notNull(),
    catalog_scope: text('catalog_scope').notNull().default('global'),
    workspace_id: text('workspace_id'),
    app_display_name: text('app_display_name').notNull(),
    app_category: text('app_category'),
    auth_type: text('auth_type').notNull().default('none'),
    app_status: text('app_status').notNull().default('active'),
    allowed_request_origins: jsonb('allowed_request_origins')
      .$type<readonly string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    display_config: jsonb('display_config')
      .$type<AppDisplayConfigData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    app_config: jsonb('app_config').$type<AppConfigData>().notNull().default(sql`'{}'::jsonb`),
    metadata: metadata<AppMetadataData>(),
    ...lifecycle_columns,
  },
  (table) => [
    check('apps_app_key_matches_name', sql`${table.app_key} = ${table.app_name}`),
    uniqueIndex('idx_apps_global_name_unique')
      .on(table.app_name)
      .where(sql`${table.catalog_scope} = 'global' AND ${table.workspace_id} IS NULL`),
    uniqueIndex('idx_apps_workspace_name_unique')
      .on(table.workspace_id, table.app_name)
      .where(sql`${table.catalog_scope} = 'workspace'`),
    index('idx_apps_catalog_visibility').on(table.catalog_scope, table.workspace_id),
  ],
);

export const nodes = pgTable(
  'nodes',
  {
    node_id: text('node_id').primaryKey(),
    app_id: text('app_id').notNull(),
    app_key: text('app_key').notNull(),
    node_name: text('node_name').notNull(),
    catalog_scope: text('catalog_scope').notNull().default('global'),
    workspace_id: text('workspace_id'),
    node_key: text('node_key').notNull(),
    node_version: integer('node_version').notNull().default(1),
    node_display_name: text('node_display_name').notNull(),
    node_kind: text('node_kind').notNull(),
    input_schema: jsonb('input_schema').$type<NodeInputSchemaData>().notNull(),
    output_schema: jsonb('output_schema'),
    approval_policy: jsonb('approval_policy')
      .$type<ApprovalPolicyData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    runtime_handler: text('runtime_handler').notNull(),
    node_runtime: text('node_runtime').notNull().default('native_tool'),
    node_status: text('node_status').notNull().default('active'),
    discovery_status: text('discovery_status').notNull().default('visible'),
    successor_node_key: text('successor_node_key'),
    provider_key: text('provider_key').notNull().default('native'),
    provider_config_key: text('provider_config_key').notNull().default('native:default'),
    provider_config_version: integer('provider_config_version').notNull().default(1),
    connection_profile_key: text('connection_profile_key'),
    connection_profile_version: integer('connection_profile_version'),
    required_scopes: jsonb('required_scopes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    required_account_properties: jsonb('required_account_properties')
      .notNull()
      .default(sql`'[]'::jsonb`),
    node_config: jsonb('node_config').$type<NodeConfigData>().notNull().default(sql`'{}'::jsonb`),
    metadata: metadata<NodeMetadataData>(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_nodes_app_name_unique').on(table.app_id, table.node_name),
    // One canonical node_key per scope. Partial indexes because workspace_id is nullable and a
    // plain unique index would treat NULL workspace_ids as distinct, missing global-catalog dupes.
    uniqueIndex('idx_nodes_global_key_unique')
      .on(table.node_key)
      .where(sql`${table.catalog_scope} = 'global' AND ${table.workspace_id} IS NULL`),
    uniqueIndex('idx_nodes_workspace_key_unique')
      .on(table.workspace_id, table.node_key)
      .where(sql`${table.catalog_scope} = 'workspace'`),
    index('idx_nodes_catalog_visibility').on(table.catalog_scope, table.workspace_id),
    index('idx_nodes_provider_profile').on(
      table.provider_key,
      table.provider_config_key,
      table.provider_config_version,
      table.connection_profile_key,
      table.connection_profile_version,
    ),
    index('idx_nodes_kind_status').on(table.node_kind, table.node_status),
  ],
);

export const agent_nodes = pgTable(
  'agent_nodes',
  {
    agent_node_id: text('agent_node_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_id: text('agent_id').notNull(),
    node_id: text('node_id').notNull(),
    connection_id: text('connection_id'),
    agent_node_status: text('agent_node_status').notNull().default('enabled'),
    instance_config: jsonb('instance_config').notNull().default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_agent_nodes_agent_node_unique').on(table.agent_id, table.node_id),
    index('idx_agent_nodes_workspace_agent').on(table.workspace_id, table.agent_id),
  ],
);

export const connections = pgTable(
  'connections',
  {
    connection_id: text('connection_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    app_id: text('app_id').notNull(),
    connection_key: text('connection_key').notNull().default(''),
    connection_name: text('connection_name'),
    connection_status: text('connection_status').notNull().default('pending_setup'),
    provider_key: text('provider_key').notNull().default('native'),
    provider_config_key: text('provider_config_key').notNull().default('native:default'),
    provider_config_version: integer('provider_config_version').notNull().default(1),
    connection_profile_key: text('connection_profile_key').notNull().default('native:default'),
    connection_profile_version: integer('connection_profile_version').notNull().default(1),
    auth_method_key: text('auth_method_key').notNull().default('none'),
    external_user_key: text('external_user_key'),
    credentials: jsonb('credentials').$type<ConnectionCredentialData>(),
    credential_expiry_time: timestamp('credential_expiry_time', { withTimezone: true }),
    external_account_id: text('external_account_id'),
    external_account_name: text('external_account_name'),
    authorized_scopes: jsonb('authorized_scopes')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    health_status: text('health_status').notNull().default('unknown'),
    connected_by: text('connected_by'),
    connected_time: timestamp('connected_time', { withTimezone: true }),
    last_checked_time: timestamp('last_checked_time', { withTimezone: true }),
    last_provider_update_time: timestamp('last_provider_update_time', { withTimezone: true }),
    revoked_time: timestamp('revoked_time', { withTimezone: true }),
    connection_config: jsonb('connection_config')
      .$type<ConnectionConfigData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    setup_state: jsonb('setup_state')
      .$type<ConnectionSetupStateData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    provider_account: jsonb('provider_account')
      .$type<ProviderAccountData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metadata: metadata<ConnectionMetadataData>(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_connections_workspace_app').on(table.workspace_id, table.app_id),
    uniqueIndex('idx_connections_workspace_key_unique').on(
      table.workspace_id,
      table.connection_key,
    ),
    index('idx_connections_provider_profile').on(
      table.workspace_id,
      table.provider_key,
      table.provider_config_key,
      table.provider_config_version,
      table.connection_profile_key,
      table.connection_profile_version,
    ),
    // One Alfera workspace per exclusive channel account: native Slack routes inbound
    // events solely by team_id (external_account_id), so a team belongs to at most one
    // workspace at a time. Scoped to native Slack — providers routed per-connection
    // (whose external_account_id is not globally unique) must stay out of this
    // predicate. Mirrors migration 0022 and the provider list in
    // runtime-platform/channels/exclusive_external_account_claims.ts.
    uniqueIndex('idx_connections_exclusive_account_active')
      .on(table.provider_key, table.provider_config_key, table.external_account_id)
      .where(
        sql`${table.connection_status} = 'active' and ${table.provider_key} = 'native' and ${table.provider_config_key} = 'native:slack' and ${table.external_account_id} is not null`,
      ),
    index('idx_connections_pending_setup_expiry')
      .on(table.created_time)
      .where(sql`${table.connection_status} = 'pending_setup'`),
  ],
);

export const channels = pgTable(
  'channels',
  {
    channel_id: text('channel_id').primaryKey(),
    channel_key: text('channel_key').notNull(),
    workspace_id: text('workspace_id').notNull(),
    connection_id: text('connection_id'),
    channel_provider_key: text('channel_provider_key').notNull(),
    channel_name: text('channel_name'),
    channel_status: text('channel_status').notNull().default('enabled'),
    external_account_id: text('external_account_id'),
    external_conversation_id: text('external_conversation_id'),
    external_thread_id: text('external_thread_id'),
    conversation_scope: text('conversation_scope').notNull().default('any'),
    routing_priority: integer('routing_priority').notNull().default(0),
    target_kind: text('target_kind').notNull().default('agent'),
    target_id: text('target_id').notNull(),
    channel_source: jsonb('channel_source').notNull().default(sql`'{}'::jsonb`),
    channel_config: jsonb('channel_config')
      .$type<ChannelConfigData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    channel_target: jsonb('channel_target').notNull().default(sql`'{}'::jsonb`),
    // The project a conversation through this route starts in: its instructions, its tools. NULL
    // is no project, as every route was before (migration 0076).
    project_id: text('project_id'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_channels_workspace_key_unique').on(table.workspace_id, table.channel_key),
    index('idx_channels_project')
      .on(table.workspace_id, table.project_id)
      .where(sql`${table.project_id} IS NOT NULL`),
    index('idx_channels_workspace_target').on(
      table.workspace_id,
      table.target_kind,
      table.target_id,
    ),
    index('idx_channels_lookup').on(
      table.workspace_id,
      table.channel_provider_key,
      table.connection_id,
      table.channel_status,
      table.external_account_id,
      table.external_conversation_id,
      table.conversation_scope,
      table.target_kind,
      table.target_id,
    ),
  ],
);

export const triggers = pgTable(
  'triggers',
  {
    trigger_id: text('trigger_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_id: text('agent_id').notNull(),
    node_id: text('node_id'),
    automation_id: text('automation_id'),
    trigger_name: text('trigger_name').notNull().default('Untitled trigger'),
    trigger_type: text('trigger_type').notNull(),
    trigger_status: text('trigger_status').notNull().default('enabled'),
    trigger_config: jsonb('trigger_config')
      .$type<TriggerConfigData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    trigger_source: jsonb('trigger_source')
      .$type<TriggerSourceData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    trigger_target: jsonb('trigger_target').notNull().default(sql`'{}'::jsonb`),
    schedule_expression: text('schedule_expression'),
    next_run_time: timestamp('next_run_time', { withTimezone: true }),
    last_run_time: timestamp('last_run_time', { withTimezone: true }),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_triggers_workspace_agent').on(table.workspace_id, table.agent_id),
    index('idx_triggers_automation')
      .on(table.workspace_id, table.automation_id)
      .where(sql`${table.automation_id} IS NOT NULL`),
  ],
);

export const runtime_environments = pgTable(
  'runtime_environments',
  {
    runtime_environment_id: text('runtime_environment_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_id: text('agent_id'),
    session_id: text('session_id'),
    environment_provider: text('environment_provider').notNull(),
    environment_status: text('environment_status').notNull(),
    provider_environment_id: text('provider_environment_id'),
    workspace_mount_key: text('workspace_mount_key'),
    root_path: text('root_path').notNull().default('/work'),
    last_started_time: timestamp('last_started_time', { withTimezone: true }),
    last_stopped_time: timestamp('last_stopped_time', { withTimezone: true }),
    last_heartbeat_time: timestamp('last_heartbeat_time', { withTimezone: true }),
    environment_config: jsonb('environment_config')
      .$type<RuntimeEnvironmentData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    environment_metadata: jsonb('environment_metadata')
      .$type<RuntimeEnvironmentData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_runtime_environments_workspace').on(table.workspace_id),
    index('idx_runtime_environments_session').on(table.session_id),
  ],
);

export const volumes = pgTable(
  'volumes',
  {
    volume_id: text('volume_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    volume_provider: text('volume_provider').notNull(),
    volume_status: text('volume_status').notNull().default('provisioning'),
    provider_volume_id: text('provider_volume_id'),
    provider_region: text('provider_region'),
    volume_config: jsonb('volume_config')
      .$type<VolumeConfigData>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    encrypted_mount_credentials: jsonb(
      'encrypted_mount_credentials',
    ).$type<ConnectionCredentialData>(),
    last_synced_time: timestamp('last_synced_time', { withTimezone: true }),
    last_error_code: text('last_error_code'),
    last_error_message: text('last_error_message'),
    ...lifecycle_columns,
  },
  (table) => [
    check('volumes_provider_check', sql`${table.volume_provider} IN ('archil')`),
    check(
      'volumes_status_check',
      sql`${table.volume_status} IN ('provisioning', 'retryable', 'active', 'unhealthy')`,
    ),
    uniqueIndex('idx_volumes_workspace_unique').on(table.workspace_id),
    uniqueIndex('idx_volumes_provider_id_unique').on(
      table.volume_provider,
      table.provider_volume_id,
    ),
  ],
);

export const sandboxes = pgTable(
  'sandboxes',
  {
    sandbox_id: text('sandbox_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_id: text('agent_id'),
    session_id: text('session_id'),
    runtime_environment_id: text('runtime_environment_id'),
    sandbox_provider: text('sandbox_provider').notNull(),
    sandbox_status: text('sandbox_status').notNull().default('pending'),
    provider_sandbox_id: text('provider_sandbox_id'),
    provider_template_id: text('provider_template_id'),
    workspace_mount_key: text('workspace_mount_key').notNull(),
    root_path: text('root_path').notNull().default('/work'),
    working_directory: text('working_directory').notNull().default('/work/repo'),
    sandbox_config: jsonb('sandbox_config').notNull().default(sql`'{}'::jsonb`),
    sandbox_metadata: jsonb('sandbox_metadata').notNull().default(sql`'{}'::jsonb`),
    last_started_time: timestamp('last_started_time', { withTimezone: true }),
    last_paused_time: timestamp('last_paused_time', { withTimezone: true }),
    last_stopped_time: timestamp('last_stopped_time', { withTimezone: true }),
    last_heartbeat_time: timestamp('last_heartbeat_time', { withTimezone: true }),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_sandboxes_workspace').on(table.workspace_id),
    index('idx_sandboxes_session').on(table.session_id),
    index('idx_sandboxes_runtime_environment').on(table.runtime_environment_id),
    uniqueIndex('idx_sandboxes_provider_mount_unique').on(
      table.workspace_id,
      table.sandbox_provider,
      table.workspace_mount_key,
    ),
  ],
);

export const usage_records = pgTable(
  'usage_records',
  {
    usage_record_id: text('usage_record_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    agent_id: text('agent_id'),
    session_id: text('session_id'),
    run_id: text('run_id'),
    usage_date: date('usage_date').notNull(),
    usage_kind: text('usage_kind').notNull(),
    provider: text('provider'),
    provider_name: text('provider_name'),
    quantity: numeric('quantity').notNull(),
    unit: text('unit').notNull(),
    cost_cents: integer('cost_cents').notNull().default(0),
    cost_microcents: bigint('cost_microcents', { mode: 'number' }).notNull().default(0),
    api_key_id: text('api_key_id'),
    usage_metadata: jsonb('usage_metadata').notNull().default(sql`'{}'::jsonb`),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_usage_records_workspace_date').on(table.workspace_id, table.usage_date),
    index('idx_usage_records_api_key_date')
      .on(table.api_key_id, table.created_time)
      .where(sql`${table.api_key_id} IS NOT NULL`),
  ],
);

export const billing_plans = pgTable(
  'billing_plans',
  {
    billing_plan_id: text('billing_plan_id').primaryKey(),
    plan_slug: text('plan_slug').notNull(),
    plan_name: text('plan_name').notNull(),
    stripe_product_id: text('stripe_product_id'),
    stripe_price_id: text('stripe_price_id'),
    billing_interval: text('billing_interval').notNull().default('month'),
    monthly_price_cents: integer('monthly_price_cents'),
    included_usage: jsonb('included_usage').notNull().default(sql`'{}'::jsonb`),
    plan_limits: jsonb('plan_limits').notNull().default(sql`'{}'::jsonb`),
    plan_status: text('plan_status').notNull().default('active'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [uniqueIndex('idx_billing_plans_slug_unique').on(table.plan_slug)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    subscription_id: text('subscription_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    billing_plan_id: text('billing_plan_id').notNull(),
    stripe_customer_id: text('stripe_customer_id'),
    stripe_subscription_id: text('stripe_subscription_id'),
    subscription_status: text('subscription_status').notNull().default('trialing'),
    current_period_start_time: timestamp('current_period_start_time', { withTimezone: true }),
    current_period_end_time: timestamp('current_period_end_time', { withTimezone: true }),
    cancel_at_period_end: boolean('cancel_at_period_end').notNull().default(false),
    payment_method_brand: text('payment_method_brand'),
    payment_method_last4: text('payment_method_last4'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [index('idx_subscriptions_workspace').on(table.workspace_id)],
);

export const billing_credit_ledger = pgTable(
  'billing_credit_ledger',
  {
    billing_credit_ledger_id: text('billing_credit_ledger_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    entry_type: text('entry_type').notNull(),
    amount_microcents: bigint('amount_microcents', { mode: 'number' }).notNull(),
    source: text('source').notNull().default('system'),
    stripe_invoice_id: text('stripe_invoice_id'),
    stripe_payment_intent_id: text('stripe_payment_intent_id'),
    description: text('description'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    index('idx_credit_ledger_workspace').on(table.workspace_id),
    uniqueIndex('idx_credit_ledger_invoice_unique')
      .on(table.stripe_invoice_id)
      .where(sql`${table.stripe_invoice_id} IS NOT NULL`),
    uniqueIndex('idx_credit_ledger_payment_intent_unique')
      .on(table.stripe_payment_intent_id)
      .where(sql`${table.stripe_payment_intent_id} IS NOT NULL`),
  ],
);

export const api_keys = pgTable(
  'api_keys',
  {
    api_key_id: text('api_key_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    key_hash: text('key_hash').notNull(),
    key_prefix: text('key_prefix').notNull(),
    key_name: text('key_name').notNull(),
    scopes: text('scopes').array().notNull(),
    key_audience: text('key_audience').notNull().default('internal'),
    last_used_time: timestamp('last_used_time', { withTimezone: true }),
    expires_time: timestamp('expires_time', { withTimezone: true }),
    revoked_time: timestamp('revoked_time', { withTimezone: true }),
    // Fixed window in Postgres — sliding window/Redis only with measured need.
    rate_window_start_time: timestamp('rate_window_start_time', { withTimezone: true }),
    rate_window_request_count: integer('rate_window_request_count').notNull().default(0),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    uniqueIndex('idx_api_keys_hash_unique').on(table.key_hash),
    index('idx_api_keys_workspace').on(table.workspace_id),
  ],
);
