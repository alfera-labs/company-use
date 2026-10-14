import type { EventJobHandler } from '@coworker/jobs';
import { agent_heartbeat_job_handler, create_logger } from '@coworker/shared';
import { run_api_answer_job } from '@runtime-platform/events/api_answer_job';
import { run_api_session_turn_job } from '@runtime-platform/events/api_session_turn_job';
import { run_attention_tick_job } from '@runtime-platform/events/attention_tick_job';
import { run_automation_miner_job } from '@runtime-platform/events/automation_miner_job';
import { run_automation_watchdog_job } from '@runtime-platform/events/automation_watchdog_job';
import { run_calendar_offset_sweep_job } from '@runtime-platform/events/calendar_offset_sweep_job';
import { run_connection_resume_job } from '@runtime-platform/events/connection_resume_job';
import { run_connector_batch_job } from '@runtime-platform/events/connector_batch_job';
import { run_connector_canary_job } from '@runtime-platform/events/connector_canary_job';
import { run_daily_summary_job } from '@runtime-platform/events/daily_summary_job';
import { run_email_agent_message_job } from '@runtime-platform/events/email/agent_message_job';
import { run_mcp_tool_sync_job } from '@runtime-platform/events/mcp_tool_sync_job';
import { run_notification_answer_job } from '@runtime-platform/events/notification_answer_job';
import { run_policy_decision_resume_job } from '@runtime-platform/events/policy_decision_resume_job';
import { run_automation_job } from '@runtime-platform/events/run_automation_job';
import { run_scheduled_agent_task_job } from '@runtime-platform/events/scheduled_agent_task_job';
import { run_scout_pulse_job } from '@runtime-platform/events/scout_pulse_job';
import { run_session_agent_message_job } from '@runtime-platform/events/session_agent_message_job';
import { run_slack_agent_message_job } from '@runtime-platform/events/slack/agent_message_job';
import { run_slack_discovery_channel_job } from '@runtime-platform/events/slack_discovery_channel_job';
import { run_slack_discovery_job } from '@runtime-platform/events/slack_discovery_job';
import { run_slack_discovery_summary_job } from '@runtime-platform/events/slack_discovery_summary_job';
import { run_slack_member_sync_job } from '@runtime-platform/events/slack_member_sync_job';
import { run_slack_workflow_proposal_job } from '@runtime-platform/events/slack_workflow_proposal_job';
import { run_triage_signal_job } from '@runtime-platform/events/triage_signal_job';
import { run_volume_snapshot_job } from '@runtime-platform/events/volume_snapshot_job';
import {
  brain_chunk_embedding_job,
  brain_source_crawl_job,
  memory_conversation_day_job,
  memory_save_retry_job,
  memory_scope_consolidation_job,
} from '@runtime-platform/memory_host/memory_event_job_handlers';

export {
  job_handler_starts_an_agent_run,
  job_handlers_that_start_agent_runs,
} from '@coworker/shared';

const run_by_job_handler: Record<string, EventJobHandler['run']> = {
  api_answer_job: run_api_answer_job,
  api_session_turn_job: run_api_session_turn_job,
  slack_agent_message: run_slack_agent_message_job,
  email_agent_message: run_email_agent_message_job,
  session_agent_message: run_session_agent_message_job,
  connection_resume: run_connection_resume_job,
  notification_answer: run_notification_answer_job,
  policy_decision_resume: run_policy_decision_resume_job,
  run_scheduled_agent_task: run_scheduled_agent_task_job,
  run_automation: run_automation_job,
  triage_signal: run_triage_signal_job,
  run_attention_tick: run_attention_tick_job,
  run_daily_summary: run_daily_summary_job,
  run_automation_watchdog: run_automation_watchdog_job,
  run_calendar_offset_sweep: run_calendar_offset_sweep_job,
  run_automation_miner: run_automation_miner_job,
  [agent_heartbeat_job_handler]: run_scout_pulse_job,
  create_volume_snapshot: run_volume_snapshot_job,
  mcp_tool_sync: run_mcp_tool_sync_job,
  connector_batch: run_connector_batch_job,
  connector_canary: run_connector_canary_job,
  slack_discovery: run_slack_discovery_job,
  slack_discovery_channel: run_slack_discovery_channel_job,
  slack_discovery_summary: run_slack_discovery_summary_job,
  slack_workflow_proposal: run_slack_workflow_proposal_job,
  slack_member_sync: run_slack_member_sync_job,
};

const event_job_handlers: Record<string, EventJobHandler> = {
  ...Object.fromEntries(
    Object.entries(run_by_job_handler).map(([name, run]) => [name, { job_handler: name, run }]),
  ),
  brain_source_crawl: brain_source_crawl_job,
  brain_chunk_embedding: brain_chunk_embedding_job,
  memory_save_retry: memory_save_retry_job,
  memory_conversation_day: memory_conversation_day_job,
  memory_scope_consolidation: memory_scope_consolidation_job,
};

const deleted_memory_job_handlers = new Set([
  'brain_document_ocr',
  'memory_archive_import',
  'memory_discovery',
  'memory_discovery_channel',
  'memory_discovery_summary',
  'memory_discovery_watchdog',
  'memory_nightly',
  'run_workspace_discovery',
  'workflow_proposal',
]);

const deleted_memory_log = create_logger('memory');

const renamed_job_handlers: Record<string, string> = {
  run_routine: 'run_automation',
  run_routine_watchdog: 'run_automation_watchdog',
};

export function find_event_job_handler(job_handler: string): EventJobHandler | null {
  const current_name = renamed_job_handlers[job_handler] ?? job_handler;
  const handler = event_job_handlers[current_name as keyof typeof event_job_handlers] ?? null;
  if (handler) return handler;
  if (!deleted_memory_job_handlers.has(job_handler)) return null;
  return {
    job_handler,
    run: async () => {
      deleted_memory_log.debug('drained a deleted memory job without running it', { job_handler });
      return { job_status: 'done', result_data: { skipped: 'memory_deleted' } };
    },
  };
}
