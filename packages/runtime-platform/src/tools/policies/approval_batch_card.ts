import { escape_slack_entities } from '@runtime-platform/channels/slack/message_format';
import type { ApprovalBatch } from '@runtime-platform/tools/policies/approval_batch_grant';
import { max_named_recipients } from '@runtime-platform/tools/policies/approval_batch_grant';
import {
  approval_approve_batch_action_id,
  approval_refuse_action_id,
  clip,
  decision_button,
  open_in_alfera_button,
  settings_footer,
} from '@runtime-platform/tools/policies/approval_card_parts';
import type { ToolApprovalView } from '@runtime-platform/tools/policies/approval_reader_service';

export type ApprovalCard = { text: string; blocks: unknown[] };

export function build_batch_approval_card(
  view: ToolApprovalView,
  batch: ApprovalBatch,
): ApprovalCard {
  const text = `I need your OK to run ${batch.node_key} for ${batch.call_count} recipients.`;
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: headline(batch) } },
      { type: 'section', text: { type: 'mrkdwn', text: template_lines(view, batch) } },
      { type: 'section', text: { type: 'mrkdwn', text: recipient_lines(batch) } },
      {
        type: 'actions',
        elements: [
          decision_button(
            `Approve all ${batch.call_count}`,
            'primary',
            approval_approve_batch_action_id,
            view.job_id,
          ),
          decision_button('Refuse', 'danger', approval_refuse_action_id, view.job_id),
          open_in_alfera_button(),
        ],
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: cap_line(batch) }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: settings_footer }] },
    ],
  };
}

function headline(batch: ApprovalBatch) {
  return [
    `I need your OK to run *${escape_slack_entities(batch.node_key)}* for *${batch.call_count} recipients*.`,
    '_Same message every time — only who it goes to changes._',
  ].join('\n');
}

function template_lines(view: ToolApprovalView, batch: ApprovalBatch) {
  const [first] = view.calls;
  const record = (first?.input ?? {}) as Record<string, unknown>;
  return batch.template_fields
    .map(
      (field) =>
        `*${escape_slack_entities(field)}:* ${escape_slack_entities(clip(stringify(record[field])))}`,
    )
    .join('\n');
}

function recipient_lines(batch: ApprovalBatch) {
  const named = batch.recipients.slice(0, max_named_recipients);
  const rest = batch.recipients.length - named.length;
  const tail = rest > 0 ? `, and ${rest} more` : '';
  return `*${batch.varying_fields.join(', ')}:* ${escape_slack_entities(named.join(', '))}${tail}`;
}

function cap_line(batch: ApprovalBatch) {
  return `Approving this allows up to ${batch.max_per_day} of these a day, for this exact message only.`;
}

function stringify(value: unknown) {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}
