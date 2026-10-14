import type { EmailTag } from '@runtime-platform/channels/email/resend_api';
import {
  find_sent_email_by_tag,
  type SentEmailLookup,
} from '@runtime-platform/channels/email/resend_sent_email_search';

const tool_call_tag_name = 'tool_call_id';
const provider_clock_margin_ms = 5 * 60 * 1000;

export function sent_by_tool_call_tag(tool_call_id: string): EmailTag {
  return { name: tool_call_tag_name, value: tool_call_id };
}

export function find_email_sent_by_tool_call(call: {
  tool_call_id: string;
  started_time: Date;
}): Promise<SentEmailLookup> {
  return find_sent_email_by_tag({
    tag: sent_by_tool_call_tag(call.tool_call_id),
    sent_after: new Date(call.started_time.getTime() - provider_clock_margin_ms),
  });
}
