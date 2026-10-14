import type { Notification } from '@runtime-platform/notifications/notification_body';
import type { NotificationDecision } from '@runtime-platform/notifications/notification_outcome';
import type {
  WriteNotificationInput,
  WriteNotificationResult,
} from '@runtime-platform/notifications/write_notification';

export function build_outcome_row(
  input: WriteNotificationInput,
  judged: {
    notification: Notification;
    fingerprint: string;
    decision: NotificationDecision;
    rules: { policy_hash: string };
    urgency_was_coerced: boolean;
  },
) {
  const { notification, decision } = judged;
  return {
    workspace_id: input.workspace_id,
    subject: notification.subject,
    fingerprint: judged.fingerprint,
    outcome: decision.outcome,
    actor_id: input.actor_id,
    notification: {
      agent_id: input.agent_id,
      automation_id: notification.automation_id,
      run_id: notification.run_id,
      session_id: notification.session_id,
      principal_id: notification.principal_id,
      title: notification.title,
      body: notification.body,
      urgency: notification.urgency,
      score: notification.score,
      outcome_reason: decision.outcome_reason,
      held: decision.held,
      policy_hash: judged.rules.policy_hash,
      evidence: notification.evidence,
      proposed_action: notification.proposed_action,
      delivered_on: null,
      delivery_ref: null,
      delivery_error: null,
      expires_time: notification.expires_time,
      metadata: {
        subject: notification.subject,
        score_reason: notification.reason,
        ...(judged.urgency_was_coerced ? { urgency_coerced_from: 'system_problem' } : {}),
        ...(input.only_the_principal_reads ? { only_the_principal_reads: true } : {}),
      },
    },
  };
}

export function already_notified(
  fingerprint: string,
  policy_hash: string,
): WriteNotificationResult {
  return {
    notification_event_id: null,
    notification_fingerprint: fingerprint,
    outcome: 'drop_with_reason',
    outcome_reason: 'this fingerprint has already been notified',
    delivered_on: null,
    delivery_ref: null,
    delivery_error: null,
    policy_hash,
  };
}
