import { has_scheduled_task_run_authority } from '@coworker/core';
import { read_trusted_email_turn_context } from '@runtime-platform/channels/email/event_payloads';
import type { RuntimeToolSourceContext } from '@runtime-platform/tools/types';

type SystemRun = {
  actor_id: string;
  source_context?: RuntimeToolSourceContext | undefined;
};

/**
 * A run no person started may change something outside the workspace only when a person
 * stands behind it: someone authorized this exact scheduled task, or a workspace member
 * whose address the mail provider proved sent the email that started the run.
 */
export function system_run_has_human_authority(run: SystemRun) {
  return scheduled_task_was_authorized(run) || email_came_from_a_proven_member(run);
}

function scheduled_task_was_authorized(run: SystemRun) {
  return (
    run.actor_id === 'system:trigger' &&
    has_scheduled_task_run_authority(run.source_context?.source_metadata)
  );
}

function email_came_from_a_proven_member(run: SystemRun) {
  return (
    run.actor_id === 'system:email' &&
    read_trusted_email_turn_context(run.source_context)?.sender_is_workspace_member === true
  );
}
