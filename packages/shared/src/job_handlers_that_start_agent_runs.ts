import { agent_heartbeat_job_handler } from '@shared/agent_heartbeat_stored_values';
import { session_agent_message_job_handler } from '@shared/session_message_queue';

export const job_handlers_that_start_agent_runs = [
  'slack_agent_message',
  'email_agent_message',
  'run_scheduled_agent_task',
  'run_automation',
  agent_heartbeat_job_handler,
  'connection_resume',
  'notification_answer',
  'policy_decision_resume',
  'api_answer_job',
  session_agent_message_job_handler,
  'api_session_turn_job',
] as const;

type JobHandlerThatStartsAnAgentRun = (typeof job_handlers_that_start_agent_runs)[number];

export function job_handler_starts_an_agent_run(
  handler: string,
): handler is JobHandlerThatStartsAnAgentRun {
  return job_handlers_that_start_agent_runs.includes(handler as JobHandlerThatStartsAnAgentRun);
}

export const job_handlers_that_count_toward_the_workspace_run_limit =
  job_handlers_that_start_agent_runs.filter(
    (handler) => handler !== session_agent_message_job_handler,
  );
