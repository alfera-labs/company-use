import { find_email_sent_by_tool_call } from '@runtime-platform/channels/email/sent_email_lookup';
import { member_link_tool_repeat_safety } from '@runtime-platform/tools/definitions/member_link_tools';
import { z } from 'zod';

export type ToolRepeatSafety = 'safe_to_repeat' | 'check_before_repeat' | 'ask_a_person';

export const tool_repeat_safety_by_tool: Readonly<Record<string, ToolRepeatSafety>> = {
  'email-send-1': 'check_before_repeat',
  'email-respond-1': 'check_before_repeat',
  ...member_link_tool_repeat_safety,
};

export type UnfinishedToolCall = {
  tool_call_id: string;
  tool_name: string;
  tool_call_metadata: unknown;
  started_time: Date;
};

export type ExistingEffect =
  | { status: 'found'; summary: string; details: Record<string, unknown> }
  | { status: 'not_found' }
  | { status: 'unknown'; reason: string };

export type FindExistingEffect = (call: UnfinishedToolCall) => Promise<ExistingEffect>;

export const find_existing_effect_by_tool: Readonly<Record<string, FindExistingEffect>> = {
  'email-send-1': find_sent_email,
  'email-respond-1': find_sent_email,
};

const declares_it_only_reads = z.union([
  z.object({ policy: z.object({ risk_class: z.literal('read') }) }),
  z.object({ approval_policy: z.object({ reason: z.literal('composio_read_only_hint') }) }),
]);

const memory_root_path_prefix = '/memory/';

const declares_a_write_path = z.object({ write_path: z.string() });

function writes_into_memory(call: UnfinishedToolCall): boolean {
  const parsed = declares_a_write_path.safeParse(call.tool_call_metadata);
  return parsed.success && parsed.data.write_path.startsWith(memory_root_path_prefix);
}

export function find_tool_repeat_safety(call: UnfinishedToolCall): ToolRepeatSafety {
  const listed = tool_repeat_safety_by_tool[call.tool_name];
  if (listed === 'check_before_repeat' && !find_existing_effect_by_tool[call.tool_name]) {
    return 'ask_a_person';
  }
  if (listed) return listed;
  if (writes_into_memory(call)) return 'safe_to_repeat';
  return declares_it_only_reads.safeParse(call.tool_call_metadata).success
    ? 'safe_to_repeat'
    : 'ask_a_person';
}

async function find_sent_email(call: UnfinishedToolCall): Promise<ExistingEffect> {
  try {
    const lookup = await find_email_sent_by_tool_call(call);
    if (lookup.status !== 'found') return lookup;
    return {
      status: 'found',
      summary: 'This email was already sent before a restart. It was not sent again.',
      details: { sent: true, email_id: lookup.email_id },
    };
  } catch (error) {
    return {
      status: 'unknown',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
